package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"pairfob/internal/journal"
	"pairfob/internal/runtime"
)

func TestAgentTracePiSummaryDetailAndUntrustedPath(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "sessions", "project", "pi.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	lines := []any{
		map[string]any{"type": "session", "version": 3, "id": "pi-session-01", "cwd": "/private/work"},
		map[string]any{"type": "message", "id": "user0001", "parentId": nil, "message": map[string]any{"role": "system", "content": "PRIVATE SYSTEM"}},
		map[string]any{"type": "message", "id": "asst0001", "parentId": "user0001", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "toolCall", "id": "call:1", "name": "Read", "arguments": map[string]any{"path": "secret.txt"}}}}},
		map[string]any{"type": "message", "id": "tool0001", "parentId": "asst0001", "message": map[string]any{"role": "toolResult", "toolCallId": "call:1", "toolName": "Read", "content": []any{map[string]any{"type": "image", "data": "BASE64_PRIVATE", "mimeType": "image/png"}, map[string]any{"type": "text", "text": "tool output"}}, "isError": false}},
	}
	var content strings.Builder
	for _, line := range lines {
		encoded, _ := json.Marshal(line)
		content.Write(encoded)
		content.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(content.String()), 0600); err != nil {
		t.Fatal(err)
	}
	fake := runtime.NewFake()
	fake.Snap.Panes[0].Agent = "pi"
	fake.Snap.Panes[0].AgentSession = &runtime.AgentSessionRef{Source: "herdr:pi", Agent: "pi", Kind: "path", Value: path}
	engine, client := runtimeRPCClient(t, fake)
	engine.Journal = &journal.Reader{PiRoot: root}
	raw, err := client.RPC("AgentTraceSummary", map[string]any{"pane_id": "w0:p1", "limit": 20})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "secret.txt") || strings.Contains(string(raw), "tool output") || strings.Contains(string(raw), "PRIVATE SYSTEM") || strings.Contains(string(raw), "BASE64_PRIVATE") {
		t.Fatalf("summary leaked private body: %s", raw)
	}
	result := decodeResult(t, raw)
	items := result["items"].([]any)
	tool := items[0].(map[string]any)
	detailRef := tool["detail_ref"].(string)
	detail, err := client.RPC("AgentTraceDetail", map[string]any{"pane_id": "w0:p1", "detail_ref": detailRef})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(detail), "secret.txt") || !strings.Contains(string(detail), "tool output") || strings.Contains(string(detail), "BASE64_PRIVATE") {
		t.Fatalf("bad detail: %s", detail)
	}
	fake.Snap.Panes[0].AgentSession = &runtime.AgentSessionRef{Source: "phone", Agent: "pi", Kind: "path", Value: path}
	if _, err := client.RPC("AgentTraceSummary", map[string]any{"pane_id": "w0:p1", "limit": 20}); err == nil || err.Error() != "transcript_unavailable" {
		t.Fatalf("untrusted path err=%v", err)
	}
}
