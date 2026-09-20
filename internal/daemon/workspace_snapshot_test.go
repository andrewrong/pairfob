package daemon

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"pairfob/internal/journal"
	"pairfob/internal/runtime"
	"pairfob/internal/workspace"
)

// observeFaultRuntime injects a runtime error or wrong view type on Observe.
type observeFaultRuntime struct {
	runtime.Runtime
	err  error
	view runtime.View
}

func (r *observeFaultRuntime) Observe(ctx context.Context, session runtime.SessionRef, query runtime.Query) (runtime.View, error) {
	if r.err != nil {
		return nil, r.err
	}
	if r.view != nil {
		return r.view, nil
	}
	return r.Runtime.Observe(ctx, session, query)
}

func workspaceSnapshotKey(session *string) string {
	name := ""
	if session != nil {
		name = *session
	}
	return "W\x00" + name
}

// Concurrent overlapping workspaceRoot lookups must coalesce into a single
// runtime Observe while sharing neither the ordinary display-snapshot flight
// nor its history-decorated result.
func TestWorkspaceSnapshotCoalescesOverlappingRootLookups(t *testing.T) {
	fake := runtime.NewFake()
	hold := make(chan struct{})
	rt := &stallObserve{inner: fake, hold: hold}
	engine := NewEngine(nil, nil, rt)
	key := workspaceSnapshotKey(nil)
	snapshotKey, ok := observeKey(nil, runtime.SnapshotQuery{})
	if !ok {
		t.Fatal("display snapshot must keep its own coalescing key")
	}
	if key == snapshotKey {
		t.Fatal("workspace snapshot key collides with display snapshot key")
	}

	var wg sync.WaitGroup
	roots := make([]string, 3)
	errs := make([]error, 3)
	wg.Add(1)
	go func() {
		defer wg.Done()
		roots[0], errs[0] = engine.workspaceRoot(nil, "w0:p1")
	}()
	waitUntil(t, func() bool { return engine.reads.waiterCount(key) >= 1 && rt.nCalls() == 1 })

	for i := 1; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			roots[i], errs[i] = engine.workspaceRoot(nil, "w0:p1")
		}()
	}
	waitUntil(t, func() bool { return engine.reads.waiterCount(key) >= 3 })
	if n := rt.nCalls(); n != 1 {
		t.Fatalf("overlapping workspaceRoot lookups started %d Observe calls", n)
	}
	if engine.reads.waiterCount(snapshotKey) != 0 {
		t.Fatal("workspace root lookup joined the display snapshot flight")
	}
	close(hold)
	wg.Wait()
	for i := range roots {
		if errs[i] != nil || roots[i] == "" {
			t.Fatalf("workspaceRoot %d root=%q err=%v", i, roots[i], errs[i])
		}
	}
	if roots[0] != roots[1] || roots[0] != roots[2] {
		t.Fatalf("waiters saw different roots: %q %q %q", roots[0], roots[1], roots[2])
	}
	if n := rt.nCalls(); n != 1 {
		t.Fatalf("coalesced lookups used %d Observe calls", n)
	}
}

// Sequential lookups must observe fresh state: a changed pane cwd and a closed
// pane are both visible, proving completed results are never cached.
func TestWorkspaceSnapshotNeverCachesCompletedResults(t *testing.T) {
	fake := runtime.NewFake()
	root := t.TempDir()
	fake.Snap.Panes[0].Cwd = root
	engine := NewEngine(nil, nil, fake)

	first, err := engine.workspaceRoot(nil, "w0:p1")
	if err != nil || first != root {
		t.Fatalf("first lookup root=%q err=%v", first, err)
	}

	moved := t.TempDir()
	fake.Snap.Panes[0].Cwd = moved
	second, err := engine.workspaceRoot(nil, "w0:p1")
	if err != nil || second != moved {
		t.Fatalf("cwd change was not observed: root=%q err=%v", second, err)
	}

	if _, err := fake.Execute(context.Background(), runtime.DefaultSession(), "op_clospane00000001", runtime.ClosePaneCommand{PaneID: "w0:p1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.workspaceRoot(nil, "w0:p1"); !errors.Is(err, workspace.ErrNotFound) {
		t.Fatalf("removed pane error=%v want workspace.ErrNotFound", err)
	}
}

// A workspace snapshot must skip history decoration even when the pane has a
// resolvable trusted transcript: the raw authority snapshot stays false while
// the display snapshot decorates true. If workspaceSnapshot ever routed
// through the display flight, the first assertion fails.
func TestWorkspaceSnapshotSkipsHistoryDecoration(t *testing.T) {
	root := t.TempDir()
	sessionID := "session_12345678"
	transcript := filepath.Join(root, "sessions", "2026", "08", "25", "rollout-"+sessionID+".jsonl")
	if err := os.MkdirAll(filepath.Dir(transcript), 0o700); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"trusted history"}]}}` + "\n"
	if err := os.WriteFile(transcript, []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := runtime.NewFake()
	fake.Snap.Panes[0].Agent = "codex"
	fake.Snap.Panes[0].AgentSession = &runtime.AgentSessionRef{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: sessionID}
	engine := NewEngine(nil, nil, fake)
	engine.Journal = &journal.Reader{CodexRoot: root}

	snapshot, err := engine.workspaceSnapshot(nil)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Panes[0].HistoryAvailable {
		t.Fatal("workspace snapshot decorated HistoryAvailable")
	}

	decorated, err := engine.snapshot(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !decorated.Panes[0].HistoryAvailable {
		t.Fatal("display snapshot did not decorate a resolvable trusted transcript")
	}
}

// Runtime faults and invalid view types must propagate exactly like the
// ordinary snapshot path.
func TestWorkspaceSnapshotPropagatesRuntimeErrors(t *testing.T) {
	fault := &runtime.Fault{
		Code: runtime.CodeOffline, Outcome: runtime.OutcomeNotApplied,
		Retry: runtime.RetryReadSafe, SafeMessage: "Herdr is offline",
	}
	engine := NewEngine(nil, nil, &observeFaultRuntime{Runtime: runtime.NewFake(), err: fault})
	_, err := engine.workspaceRoot(nil, "w0:p1")
	var got *runtime.Fault
	if !errors.As(err, &got) || got.Code != runtime.CodeOffline {
		t.Fatalf("runtime fault not propagated: %v", err)
	}

	engine = NewEngine(nil, nil, &observeFaultRuntime{Runtime: runtime.NewFake(), view: runtime.PaneReadView{Text: "not a snapshot"}})
	_, err = engine.workspaceRoot(nil, "w0:p1")
	if err == nil || err.Error() != "runtime returned an invalid snapshot view" {
		t.Fatalf("invalid view error=%v", err)
	}
}

// Fail-closed behavior of workspaceRoot must stay exact: an absent pane cwd
// falls back to the workspace cwd, an absent pane fails closed, and an
// invalid root is rejected.
func TestWorkspaceRootFallbackAndInvalidRootStayClosed(t *testing.T) {
	fake := runtime.NewFake()
	root := t.TempDir()
	fake.Snap.Panes[0].Cwd = "" // absent pane cwd falls back to the workspace cwd
	fake.Snap.Workspaces[0].Cwd = root
	engine := NewEngine(nil, nil, fake)

	got, err := engine.workspaceRoot(nil, "w0:p1")
	if err != nil || got != root {
		t.Fatalf("workspace cwd fallback root=%q err=%v", got, err)
	}

	if _, err := engine.workspaceRoot(nil, "w0:p9"); !errors.Is(err, workspace.ErrNotFound) {
		t.Fatalf("absent pane error=%v want workspace.ErrNotFound", err)
	}

	fake.Snap.Workspaces[0].Cwd = "relative/path"
	if _, err := engine.workspaceRoot(nil, "w0:p1"); !errors.Is(err, workspace.ErrInvalidPath) {
		t.Fatalf("invalid workspace root error=%v", err)
	}

	fake.Snap.Panes[0].Cwd = ""
	if _, err := engine.workspaceRoot(nil, "w0:p1"); !errors.Is(err, workspace.ErrInvalidPath) {
		t.Fatalf("empty root error=%v", err)
	}
}
