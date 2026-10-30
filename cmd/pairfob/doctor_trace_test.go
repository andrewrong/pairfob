package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"pairfob/internal/admin"
	"pairfob/internal/daemon"
	"pairfob/internal/journal"
	"pairfob/internal/mux"
	"pairfob/internal/runtime"
)

type traceAdmin struct {
	*interactiveAdmin
	panes []admin.TracePane
	calls atomic.Int32
}

func (a *traceAdmin) TraceCheck() []admin.TracePane {
	a.calls.Add(1)
	return a.panes
}

func startTraceAdmin(t *testing.T, svc admin.Service) string {
	t.Helper()
	sock := testSocket(t)
	ln, err := admin.Listen(sock)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _ = admin.Serve(ln, svc); close(done) }()
	t.Cleanup(func() { _ = ln.Close(); <-done })
	return sock
}

func newTraceAdmin(panes ...admin.TracePane) *traceAdmin {
	return &traceAdmin{interactiveAdmin: &interactiveAdmin{}, panes: panes}
}

func runTrace(t *testing.T, sock string) (string, string, error) {
	t.Helper()
	var out, errOut bytes.Buffer
	err := doctorTrace(&out, &errOut, sock)
	return out.String(), errOut.String(), err
}

func exitCodeOf(err error) int {
	var exit exitError
	if errors.As(err, &exit) {
		return exit.code
	}
	if err != nil {
		return 1
	}
	return 0
}

func TestDoctorTraceOutput(t *testing.T) {
	sock := startTraceAdmin(t, newTraceAdmin(
		admin.TracePane{Pane: "w0:p1", Agent: "claude", Result: "ok"},
		admin.TracePane{Pane: "w0:p2", Agent: "codex", Result: "not_found"},
	))
	out, _, _ := runTrace(t, sock)
	want := "w0:p1 claude ok\nw0:p2 codex not_found\ntraces: 1 ok, 1 not ok\n"
	if out != want {
		t.Fatalf("got %q want %q", out, want)
	}
	out, _, err := runTrace(t, startTraceAdmin(t, newTraceAdmin()))
	if err != nil || out != "traces: 0 ok, 0 not ok\n" {
		t.Fatalf("empty: %q %v", out, err)
	}
}

func TestDoctorTraceExitCodes(t *testing.T) {
	cases := []struct {
		name   string
		result string
		want   int
	}{{"ok", "ok", 0}, {"no_binding", "no_binding", 1}, {"not_found", "not_found", 1}, {"unreadable", "unreadable", 1}}
	for _, tc := range cases {
		_, _, err := runTrace(t, startTraceAdmin(t, newTraceAdmin(admin.TracePane{Pane: "w0:p1", Agent: "codex", Result: tc.result})))
		if got := exitCodeOf(err); got != tc.want {
			t.Fatalf("%s: exit %d want %d", tc.name, got, tc.want)
		}
	}
	if _, _, err := runTrace(t, startTraceAdmin(t, newTraceAdmin())); exitCodeOf(err) != 0 {
		t.Fatalf("no panes: %v", err)
	}

	_, stderr, err := runTrace(t, testSocket(t))
	if exitCodeOf(err) != 2 || !strings.Contains(stderr, "isn't running") {
		t.Fatalf("unreachable: err=%v stderr=%q", err, stderr)
	}

	svc := newTraceAdmin()
	sock := startTraceAdmin(t, svc)
	if err := runCommand([]string{"doctor", "--bogus"}, sock); err == nil || !strings.Contains(err.Error(), "usage: pairfob doctor") {
		t.Fatalf("bad argument: %v", err)
	}
	if err := runCommand([]string{"doctor", "--trace", "x"}, sock); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Fatalf("extra argument: %v", err)
	}
	t.Setenv("PAIRFOB_STATE_DIR", t.TempDir())
	_ = doctorCommand(sock) // readiness depends on this machine; only the calls matter
	if svc.calls.Load() != 0 {
		t.Fatalf("doctor without --trace called trace.check %d times", svc.calls.Load())
	}
}

func TestTraceCheckLeaksNothing(t *testing.T) {
	const sentinel = "SENTINELq7x"
	root := filepath.Join(t.TempDir(), sentinel)
	id := "session_" + sentinel
	path := filepath.Join(root, "sessions", "2026", "08", "28", "rollout-"+id+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"` + sentinel + `"}]}}` + "\n"
	if err := os.WriteFile(path, []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := runtime.NewFake()
	fake.Snap.Panes = []runtime.Pane{
		{PaneID: "w0:p1", Agent: "codex", AgentSession: &runtime.AgentSessionRef{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: id}},
		{PaneID: "w0:p2", Agent: "codex", AgentSession: &runtime.AgentSessionRef{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: "session_gone" + sentinel}},
	}
	a, _ := mux.NewPipePair(8)
	eng := daemon.NewEngine(nil, a, fake)
	eng.Journal = &journal.Reader{CodexRoot: root}
	sock := startLiveAdmin(t, eng)

	resp, err := admin.Call(sock, admin.Request{Op: "trace.check"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(resp.Result), sentinel) {
		t.Fatalf("response leaks: %s", resp.Result)
	}
	var body struct {
		Panes []map[string]any `json:"panes"`
	}
	if err := json.Unmarshal(resp.Result, &body); err != nil || len(body.Panes) != 2 {
		t.Fatalf("body %s %v", resp.Result, err)
	}
	for _, row := range body.Panes {
		if len(row) != 3 || row["pane"] == nil || row["agent"] == nil || row["result"] == nil {
			t.Fatalf("keys: %v", row)
		}
	}
	out, _, _ := runTrace(t, sock)
	if strings.Contains(out, sentinel) || out != "w0:p1 codex ok\nw0:p2 codex not_found\ntraces: 1 ok, 1 not ok\n" {
		t.Fatalf("output: %q", out)
	}
}
