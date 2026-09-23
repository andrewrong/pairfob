package runtime

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestAgentInspectVersionGate(t *testing.T) {
	for _, v := range []string{"0.8.2", "0.8.3", "0.9.0", "1.0.0", "v0.8.2+local"} {
		if !supportsAgentInspect(v) {
			t.Fatalf("rejected %s", v)
		}
	}
	for _, v := range []string{"0.8.1", "0.8.0", "0.7.99", "", "0.8.2-dev", "999999999999999999999999999.0.0", "garbage"} {
		if supportsAgentInspect(v) {
			t.Fatalf("accepted %s", v)
		}
	}
}
func TestDisplayMetadataBoundedAndDetached(t *testing.T) {
	source := map[string]string{"phase": "\x1b[31mthinking\u202e", "bad key": "bad", "task": strings.Repeat("界", 300)}
	got := displayTokens(source, false)
	if len(got) != 2 || strings.ContainsRune(got["phase"], '\x1b') || strings.ContainsRune(got["phase"], '\u202e') || len([]rune(got["task"])) != 256 {
		t.Fatalf("unsafe metadata: %+v", got)
	}
	source["task"] = "changed"
	if got["task"] == "changed" {
		t.Fatal("aliased input")
	}
	labels := displayTokens(map[string]string{"working": "phase", "complete": "bad"}, true)
	if len(labels) != 1 {
		t.Fatal(labels)
	}
}
func TestAgentInspectionOmitsPrivateEvidence(t *testing.T) {
	socket, _ := startScriptedHerdr(t, func(r scriptedRequest) scriptedReply {
		switch r.Method {
		case "session.snapshot":
			return scriptedReply{Result: map[string]any{"type": "session_snapshot", "snapshot": map[string]any{"version": "0.8.2", "protocol": 20}}}
		case "server.agent_manifests":
			return scriptedReply{Result: map[string]any{"type": "agent_manifest_status", "manifests": []any{}}}
		case "agent.explain":
			return scriptedReply{Result: map[string]any{"type": "agent_explain", "explain": map[string]any{
				"state": "idle", "manifest_source": "/private/rules/codex.toml", "manifest_version": "1.2", "matched_rule": map[string]any{"id": "ready"},
				"evaluated_rules": []any{map[string]any{"id": "ready", "state": "idle", "matched": true, "evidence": map[string]any{"region_preview": "PRIVATE_SCREEN"}}},
				"agent_session":   "PRIVATE_SESSION",
			}}}
		default:
			t.Errorf("unexpected %s", r.Method)
			return scriptedReply{}
		}
	})
	view, err := (&Herdr{Socket: socket}).Observe(context.Background(), DefaultSession(), AgentInspectQuery{PaneID: "w1:p1"})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(view)
	for _, secret := range []string{"PRIVATE_SCREEN", "PRIVATE_SESSION", "/private/rules"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("leaked %s", secret)
		}
	}
	result := view.(AgentInspection)
	if result.ManifestSource != "codex.toml" || result.MatchedRule != "ready" || len(result.Rules) != 1 || !result.Rules[0].Matched {
		t.Fatalf("bad result: %+v", result)
	}
}
func TestAgentInspectionRejectsInvalidState(t *testing.T) {
	socket, _ := startScriptedHerdr(t, func(r scriptedRequest) scriptedReply {
		switch r.Method {
		case "session.snapshot":
			return scriptedReply{Result: map[string]any{"type": "session_snapshot", "snapshot": map[string]any{"version": "0.8.2", "protocol": 20}}}
		case "server.agent_manifests":
			return scriptedReply{Result: map[string]any{"type": "agent_manifest_status"}}
		default:
			return scriptedReply{Result: map[string]any{"type": "agent_explain", "explain": map[string]any{"state": "success"}}}
		}
	})
	if _, err := (&Herdr{Socket: socket}).Observe(context.Background(), DefaultSession(), AgentInspectQuery{PaneID: "w1:p1"}); err == nil {
		t.Fatal("accepted unknown status")
	}
}

func TestSnapshotProjectsDisplayMetadataWithoutChangingStatus(t *testing.T) {
	socket, _ := startScriptedHerdr(t, func(r scriptedRequest) scriptedReply {
		return scriptedReply{Result: map[string]any{"type": "session_snapshot", "snapshot": map[string]any{
			"version": "0.8.2", "protocol": 20,
			"workspaces": []any{map[string]any{"workspace_id": "w1", "tokens": map[string]string{"branch": "feature"}, "worktree": map[string]any{"repo_name": "repo", "checkout_path": "/repo/feature", "is_linked_worktree": true, "repo_root": "/private/not-for-display"}}},
			"panes":      []any{map[string]any{"pane_id": "w1:p1", "workspace_id": "w1", "tab_id": "w1:t1", "terminal_id": "term1", "agent_status": "working"}},
			"agents":     []any{map[string]any{"pane_id": "w1:p1", "terminal_id": "term1", "agent": "codex", "agent_status": "working", "display_agent": "Reviewer", "state_labels": map[string]string{"working": "Completed!"}, "tokens": map[string]string{"task": "review"}}},
		}}}
	})
	snap, err := (&Herdr{Socket: socket}).snapshot(context.Background(), DefaultSession())
	if err != nil {
		t.Fatal(err)
	}
	pane := snap.Panes[0]
	if pane.Agent != "codex" || pane.AgentStatus != "working" || pane.DisplayAgent != "Reviewer" || pane.Tokens["task"] != "review" {
		t.Fatalf("%+v", pane)
	}
	ws := snap.Workspaces[0]
	if ws.Tokens["branch"] != "feature" || ws.Worktree == nil || !ws.Worktree.IsLinkedWorktree {
		t.Fatalf("%+v", ws)
	}
	wire, _ := json.Marshal(snap)
	if strings.Contains(string(wire), "not-for-display") {
		t.Fatal("leaked non-display fields")
	}
}
