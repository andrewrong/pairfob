package daemon

import (
	"context"
	"errors"
	"time"

	"pairfob/internal/runtime"
)

// workspaceSnapshot returns a fresh live Snapshot for workspace-root authority.
// Unlike Engine.snapshot it skips markHistory: workspaceRoot only needs the
// live pane cwd, and journal decoration is pure cost there. Overlapping calls
// coalesce under the "W\x00" key so an ordinary display snapshot flight can
// never hand these callers a mutable history-decorated SnapshotView.
func (e *Engine) workspaceSnapshot(session *string) (runtime.Snapshot, error) {
	name := ""
	if session != nil {
		name = *session
	}
	view, err := e.reads.do("W\x00"+name, func() (runtime.View, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		return e.RT.Observe(ctx, runtimeSession(session), runtime.SnapshotQuery{})
	})
	if err != nil {
		return runtime.Snapshot{}, err
	}
	snapshot, ok := view.(runtime.SnapshotView)
	if !ok {
		return runtime.Snapshot{}, errors.New("runtime returned an invalid snapshot view")
	}
	return snapshot.Snapshot, nil
}
