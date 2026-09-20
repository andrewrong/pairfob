package runtime

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestHerdrSnapshotJoinsRichAgentByPaneAndTerminal(t *testing.T) {
	ready, pending := true, false
	sequence, revision := uint64(73), uint64(11)
	socket, _ := startScriptedHerdr(t, func(request scriptedRequest) scriptedReply {
		if request.Method != "session.snapshot" {
			return standardReply(request)
		}
		return scriptedReply{Result: map[string]any{
			"type": "session_snapshot",
			"snapshot": map[string]any{
				"version": "0.8.2", "protocol": 20,
				"focused_workspace_id": "w1", "focused_tab_id": "w1:t1", "focused_pane_id": "w1:p1",
				"workspaces": []any{map[string]any{"workspace_id": "w1", "number": 1, "label": "lab", "agent_status": "working"}},
				"tabs":       []any{map[string]any{"tab_id": "w1:t1", "workspace_id": "w1", "label": "main"}},
				"panes": []any{map[string]any{
					"pane_id": "w1:p1", "terminal_id": "term_live", "workspace_id": "w1", "tab_id": "w1:t1",
					"cwd": "/tmp/lab", "agent": "legacy", "agent_status": "idle", "revision": revision,
				}},
				"agents": []any{
					map[string]any{
						"pane_id": "w1:p1", "terminal_id": "term_stale", "agent": "stale", "agent_status": "blocked",
						"revision": 99, "state_change_seq": 999, "interactive_ready": false, "launch_pending": true,
					},
					map[string]any{
						"pane_id": "w1:p1", "terminal_id": "term_live", "agent": "codex", "agent_status": "working",
						"terminal_title_stripped": "  Review auth  ", "revision": revision, "state_change_seq": sequence,
						"interactive_ready": ready, "launch_pending": pending,
						"agent_session": map[string]any{"source": "hook", "agent": "codex", "kind": "path", "value": "/private/native/session.jsonl"},
					},
				},
			},
		}}
	})
	view, err := NewHerdr(socket).Observe(context.Background(), DefaultSession(), SnapshotQuery{})
	if err != nil {
		t.Fatal(err)
	}
	pane := view.(SnapshotView).Snapshot.Panes[0]
	if pane.TerminalID != "term_live" || pane.Agent != "codex" || pane.AgentStatus != "working" || pane.TerminalTitle != "Review auth" {
		t.Fatalf("joined pane=%+v", pane)
	}
	if pane.Revision == nil || *pane.Revision != revision || pane.StateChangeSeq == nil || *pane.StateChangeSeq != sequence ||
		pane.InteractiveReady == nil || !*pane.InteractiveReady || pane.LaunchPending == nil || *pane.LaunchPending {
		t.Fatalf("rich observations missing: %+v", pane)
	}
	if len(pane.AgentInstanceID) != 64 || pane.AgentSession == nil || pane.AgentSession.Value != "/private/native/session.jsonl" {
		t.Fatalf("identity/binding missing: %+v", pane)
	}
	encoded, err := json.Marshal(pane)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "/private/native") || strings.Contains(string(encoded), "agent_session") {
		t.Fatalf("native session leaked: %s", encoded)
	}
}

func TestHerdrSnapshotLegacyOmitsRichObservations(t *testing.T) {
	socket, _ := startScriptedHerdr(t, standardReply)
	view, err := NewHerdr(socket).Observe(context.Background(), DefaultSession(), SnapshotQuery{})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(view.(SnapshotView).Snapshot.Panes[0])
	for _, field := range []string{"terminal_id", "agent_instance_id", "revision", "state_change_seq", "interactive_ready", "launch_pending"} {
		if strings.Contains(string(encoded), `"`+field+`"`) {
			t.Fatalf("legacy pane unexpectedly serialized %s: %s", field, encoded)
		}
	}
}

func TestOpaqueAgentInstanceIDBindsTerminalAndNativeSession(t *testing.T) {
	first := &AgentSessionRef{Source: "hook", Agent: "codex", Kind: "id", Value: "native-one"}
	second := &AgentSessionRef{Source: "hook", Agent: "codex", Kind: "id", Value: "native-two"}
	base := opaqueAgentInstanceID("term_one", first)
	if base != opaqueAgentInstanceID("term_one", first) || base == opaqueAgentInstanceID("term_one", second) || base == opaqueAgentInstanceID("term_two", first) {
		t.Fatal("opaque identity did not bind both terminal and native session")
	}
	if strings.Contains(base, first.Value) {
		t.Fatal("opaque identity exposed native session")
	}
}

func TestHerdrSnapshotRejectsUnsafeObservationInteger(t *testing.T) {
	socket, _ := startScriptedHerdr(t, func(request scriptedRequest) scriptedReply {
		if request.Method != "session.snapshot" {
			return standardReply(request)
		}
		return scriptedReply{Result: map[string]any{
			"type": "session_snapshot", "snapshot": map[string]any{
				"version": "0.8.2", "protocol": 20, "workspaces": []any{}, "tabs": []any{},
				"panes": []any{map[string]any{
					"pane_id": "p1", "terminal_id": "term_1", "workspace_id": "w1", "tab_id": "t1",
					"agent_status": "idle", "revision": uint64(1 << 53),
				}}, "agents": []any{},
			},
		}}
	})
	if _, err := NewHerdr(socket).Observe(context.Background(), DefaultSession(), SnapshotQuery{}); err == nil {
		t.Fatal("unsafe JavaScript integer was accepted")
	}
}
