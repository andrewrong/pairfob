package daemon

import (
	"pairfob/internal/admin"
	"pairfob/internal/journal"
	"pairfob/internal/runtime"
)

// TraceCheck runs, for each live pane with an agent session, the lookup that
// History uses, and reports only a closed result per pane: never transcript
// text, a path or a session id.
func (e *Engine) TraceCheck() []admin.TracePane {
	snapshot, err := e.snapshot(nil)
	if err != nil {
		return nil
	}
	var out []admin.TracePane
	for _, pane := range snapshot.Panes {
		if pane.AgentSession == nil {
			continue
		}
		out = append(out, admin.TracePane{Pane: pane.PaneID, Agent: traceAgent(pane.Agent, pane.AgentSession.Agent), Result: e.traceResult(pane.AgentSession)})
	}
	return out
}

func traceAgent(names ...string) string {
	for _, name := range names {
		switch name {
		case "claude", "codex", "pi", "grok":
			return name
		}
	}
	return "other"
}

func (e *Engine) traceResult(session *runtime.AgentSessionRef) string {
	ref := journalRef(session)
	if e.Journal == nil || !e.Journal.Supports(ref) {
		return "no_binding"
	}
	if _, err := e.Journal.Read(ref, nil, 1); err != nil {
		return traceReason(err)
	}
	return "ok"
}

// traceReason keeps the result inside the closed list; an error that is not
// about the transcript being unavailable counts as unreadable.
func traceReason(err error) string {
	if reason, ok := journal.UnavailableReason(err); ok {
		return string(reason)
	}
	return string(journal.ReasonUnreadable)
}
