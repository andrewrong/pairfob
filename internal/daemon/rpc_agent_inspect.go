package daemon

import (
	"context"
	"encoding/json"
	"time"

	"pairfob/internal/runtime"
)

func (e *Engine) rpcAgentInspect(s *sess, id string, params json.RawMessage) {
	var p struct {
		Session *string `json:"session"`
		PaneID  string  `json:"pane_id"`
	}
	if badParams(params, &p) || invalidSession(p.Session) || !validID(p.PaneID) {
		e.replyErr(s, id, "invalid_argument", "invalid inspection target")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	ref := runtimeSession(p.Session)
	e.touchRuntimeSession(ref)
	find := func() (*runtime.Pane, error) {
		view, err := e.RT.Observe(ctx, ref, runtime.SnapshotQuery{})
		if err != nil {
			return nil, err
		}
		snapshot, ok := view.(runtime.SnapshotView)
		if !ok {
			return nil, &runtime.Fault{Code: runtime.CodeUnsupported, SafeMessage: "invalid runtime snapshot"}
		}
		for i := range snapshot.Snapshot.Panes {
			if snapshot.Snapshot.Panes[i].PaneID == p.PaneID {
				return &snapshot.Snapshot.Panes[i], nil
			}
		}
		return nil, nil
	}
	pane, err := find()
	if err != nil {
		e.replyRuntimeErr(s, id, err, "pane_not_found")
		return
	}
	if pane == nil || pane.Agent == "" {
		e.replyErr(s, id, "agent_not_found", "pane does not host an agent")
		return
	}
	descriptor, err := e.RT.Describe(ctx, runtimeSession(p.Session))
	if err != nil {
		e.replyRuntimeErr(s, id, err, "herdr_offline")
		return
	}
	if !descriptor.Supports(runtime.FeatureAgentInspect) {
		e.replyErr(s, id, "unsupported", "agent inspection unavailable")
		return
	}
	view, err := e.RT.Observe(ctx, runtimeSession(p.Session), runtime.AgentInspectQuery{PaneID: p.PaneID})
	if err != nil {
		e.replyRuntimeErr(s, id, err, "agent_not_found")
		return
	}
	result, ok := view.(runtime.AgentInspection)
	if !ok {
		e.replyErr(s, id, "unsupported", "agent inspection unavailable")
		return
	}
	current, err := find()
	if err != nil {
		e.replyRuntimeErr(s, id, err, "pane_not_found")
		return
	}
	if current == nil || current.TerminalID != pane.TerminalID || current.AgentInstanceID != pane.AgentInstanceID || current.Agent != pane.Agent {
		e.replyErr(s, id, "conflict", "agent changed during inspection")
		return
	}
	e.reply(s, id, result)
}
