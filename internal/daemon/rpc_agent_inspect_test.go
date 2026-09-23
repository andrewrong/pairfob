package daemon

import (
	"context"
	"strings"
	"testing"

	"pairfob/internal/runtime"
)

type inspectingRuntime struct {
	runtime.Runtime
	available bool
	calls     int
	replace   bool
}

func (r *inspectingRuntime) Describe(ctx context.Context, s runtime.SessionRef) (runtime.Descriptor, error) {
	d, err := r.Runtime.Describe(ctx, s)
	d.Capabilities[runtime.FeatureAgentInspect] = runtime.Capability{Available: r.available}
	return d, err
}
func (r *inspectingRuntime) Observe(ctx context.Context, s runtime.SessionRef, q runtime.Query) (runtime.View, error) {
	if _, ok := q.(runtime.AgentInspectQuery); ok {
		r.calls++
		return runtime.AgentInspection{Status: "idle", ManifestVersion: "1", Rules: []runtime.DetectionRule{}}, nil
	}
	view, err := r.Runtime.Observe(ctx, s, q)
	if snapshot, ok := view.(runtime.SnapshotView); ok && r.replace && r.calls > 0 {
		snapshot.Snapshot.Panes = append([]runtime.Pane(nil), snapshot.Snapshot.Panes...)
		snapshot.Snapshot.Panes[0].AgentInstanceID = "replacement"
		return snapshot, err
	}
	return view, err
}
func TestAgentInspectRPCGatesAndValidates(t *testing.T) {
	rt := &inspectingRuntime{Runtime: runtime.NewFake(), available: true}
	_, client := runtimeRPCClient(t, rt)
	for _, params := range []map[string]any{{"pane_id": "../bad"}, {"pane_id": "w0:p1", "path": "/private"}, {"pane_id": "w0:p1", "session": "../socket"}} {
		if _, err := client.RPC("AgentInspect", params); err == nil {
			t.Fatal("accepted invalid inspection")
		}
	}
	raw, err := client.RPC("AgentInspect", map[string]any{"pane_id": "w0:p1"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"manifest_version":"1"`) {
		t.Fatalf("%s", raw)
	}
	if rt.calls != 1 {
		t.Fatalf("calls %d", rt.calls)
	}
}
func TestAgentInspectRPCAbsentCapabilityFailsClosed(t *testing.T) {
	rt := &inspectingRuntime{Runtime: runtime.NewFake()}
	_, client := runtimeRPCClient(t, rt)
	if _, err := client.RPC("AgentInspect", map[string]any{"pane_id": "w0:p1"}); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("%v", err)
	}
	if rt.calls != 0 {
		t.Fatal("called unadvertised query")
	}
}
func TestPromptAcknowledgementDoesNotInventWorkingStatus(t *testing.T) {
	fake := runtime.NewFake()
	fake.Snap.Panes[0].AgentStatus = "idle"
	_, client := runtimeRPCClient(t, fake)
	raw, err := client.RPC("PromptAgent", map[string]any{"pane_id": "w0:p1", "text": "test", "operation_id": "op_promptstatus00001"})
	if err != nil {
		t.Fatal(err)
	}
	result := decodeResult(t, raw)
	if result["agent_status"] != "unknown" || result["outcome"] != "applied" {
		t.Fatalf("%s", raw)
	}
}

func TestAgentInspectRPCRejectsReplacedOccupant(t *testing.T) {
	rt := &inspectingRuntime{Runtime: runtime.NewFake(), available: true, replace: true}
	_, client := runtimeRPCClient(t, rt)
	if _, err := client.RPC("AgentInspect", map[string]any{"pane_id": "w0:p1"}); err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("replacement not rejected: %v", err)
	}
}
