package daemon

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"pairfob/internal/journal"
	"pairfob/internal/runtime"
)

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	old, flags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() { log.SetOutput(old); log.SetFlags(flags) })
	return &buf
}

func TestTranscriptUnavailableLogsReason(t *testing.T) {
	root := t.TempDir()
	sessionID := "session_12345678"
	fake := runtime.NewFake()
	engine, client := runtimeRPCClient(t, fake)
	engine.Journal = &journal.Reader{CodexRoot: root}
	buf := captureLog(t)
	methods := []string{"History", "AgentTrace"}

	// No supported binding.
	for _, method := range methods {
		buf.Reset()
		if _, err := client.RPC(method, map[string]any{"pane_id": "w0:p1"}); err == nil || err.Error() != "transcript_unavailable" {
			t.Fatalf("%s: %v", method, err)
		}
		if got := buf.String(); strings.Count(got, "reason=no_binding") != 1 || strings.Count(got, "\n") != 1 {
			t.Fatalf("%s no binding log: %q", method, got)
		}
	}

	// Bound to a session that is in no root.
	fake.Snap.Panes[0].Agent = "codex"
	fake.Snap.Panes[0].AgentSession = &runtime.AgentSessionRef{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: sessionID}
	for _, method := range methods {
		buf.Reset()
		if _, err := client.RPC(method, map[string]any{"pane_id": "w0:p1"}); err == nil || err.Error() != "transcript_unavailable" {
			t.Fatalf("%s: %v", method, err)
		}
		got := buf.String()
		if strings.Count(got, "reason=not_found agent=codex kind=id") != 1 || strings.Count(got, "\n") != 1 {
			t.Fatalf("%s not found log: %q", method, got)
		}
		for _, secret := range []string{sessionID, "w0:p1", root} {
			if strings.Contains(got, secret) {
				t.Fatalf("%s log leaks %q: %q", method, secret, got)
			}
		}
	}

	// A successful read logs nothing.
	path := filepath.Join(root, "sessions", "rollout-"+sessionID+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}}` + "\n"
	if err := os.WriteFile(path, []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, method := range methods {
		buf.Reset()
		if _, err := client.RPC(method, map[string]any{"pane_id": "w0:p1"}); err != nil {
			t.Fatalf("%s: %v", method, err)
		}
		if strings.Contains(buf.String(), "transcript unavailable") {
			t.Fatalf("%s success logged: %q", method, buf.String())
		}
	}
}
