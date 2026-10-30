package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"pairfob/internal/admin"
	"pairfob/internal/journal"
	"pairfob/internal/mux"
	"pairfob/internal/runtime"
)

func traceTranscript(t *testing.T, root, id string, text string) string {
	t.Helper()
	path := filepath.Join(root, "sessions", "2026", "08", "28", "rollout-"+id+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"` + text + `"}]}}` + "\n"
	if err := os.WriteFile(path, []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func traceEngine(root string, panes ...runtime.Pane) *Engine {
	fake := runtime.NewFake()
	fake.Snap.Panes = panes
	a, _ := mux.NewPipePair(8)
	eng := NewEngine(nil, a, fake)
	eng.Journal = &journal.Reader{CodexRoot: root}
	return eng
}

func codexPane(id, session string) runtime.Pane {
	return runtime.Pane{PaneID: id, Agent: "codex", AgentSession: &runtime.AgentSessionRef{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: session}}
}

func TestTraceCheckResults(t *testing.T) {
	root := t.TempDir()
	traceTranscript(t, root, "session_okok1234", "hello")
	panes := []runtime.Pane{
		codexPane("w0:p1", "session_okok1234"),
		{PaneID: "w0:p2", Agent: "claude", AgentSession: &runtime.AgentSessionRef{Source: "phone", Agent: "claude", Kind: "id", Value: "session_nobind12"}},
		codexPane("w0:p3", "session_missing12"),
		{PaneID: "w0:p5", Agent: "codex"},
	}
	want := map[string]admin.TracePane{
		"w0:p1": {Pane: "w0:p1", Agent: "codex", Result: "ok"},
		"w0:p2": {Pane: "w0:p2", Agent: "claude", Result: "no_binding"},
		"w0:p3": {Pane: "w0:p3", Agent: "codex", Result: "not_found"},
	}
	if os.Geteuid() != 0 {
		locked := traceTranscript(t, root, "session_locked12", "x")
		if err := os.Chmod(locked, 0); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(locked, 0o600) })
		panes = append(panes, codexPane("w0:p4", "session_locked12"))
		want["w0:p4"] = admin.TracePane{Pane: "w0:p4", Agent: "codex", Result: "unreadable"}
	}
	got := traceEngine(root, panes...).TraceCheck()
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for _, row := range got {
		if want[row.Pane] != row {
			t.Fatalf("pane %s: got %+v want %+v", row.Pane, row, want[row.Pane])
		}
	}
}

func TestTraceCheckWithoutJournalIsNoBinding(t *testing.T) {
	eng := traceEngine(t.TempDir(), codexPane("w0:p1", "session_okok1234"))
	eng.Journal = nil
	got := eng.TraceCheck()
	if len(got) != 1 || got[0].Result != "no_binding" {
		t.Fatalf("got %+v", got)
	}
}

func TestTraceCheckLeaksNothing(t *testing.T) {
	const sentinel = "SENTINELq7x"
	root := filepath.Join(t.TempDir(), sentinel)
	id := "session_" + sentinel
	traceTranscript(t, root, id, sentinel)
	eng := traceEngine(root, codexPane("w0:p1", id), codexPane("w0:p2", "session_gone"+sentinel))
	body, err := json.Marshal(eng.TraceCheck())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), sentinel) {
		t.Fatalf("leak: %s", body)
	}
	var rows []map[string]any
	if err := json.Unmarshal(body, &rows); err != nil || len(rows) != 2 {
		t.Fatalf("rows %s %v", body, err)
	}
	for _, row := range rows {
		if len(row) != 3 || row["pane"] == nil || row["agent"] == nil || row["result"] == nil {
			t.Fatalf("keys: %v", row)
		}
	}
}
