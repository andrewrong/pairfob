package daemon

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"pairfob/internal/runtime"
	"pairfob/internal/state"
)

type monitorTestStream struct {
	events chan runtime.Event
	done   chan struct{}
	once   sync.Once
}

func newMonitorTestStream() *monitorTestStream {
	return &monitorTestStream{events: make(chan runtime.Event, 16), done: make(chan struct{})}
}
func (s *monitorTestStream) Events() <-chan runtime.Event { return s.events }
func (s *monitorTestStream) Done() <-chan struct{}        { return s.done }
func (s *monitorTestStream) Err() error                   { return nil }
func (s *monitorTestStream) Close() error {
	s.once.Do(func() {
		close(s.done)
		close(s.events)
	})
	return nil
}

type monitorSubscribeCall struct {
	session runtime.SessionRef
	panes   []string
	stream  *monitorTestStream
}

type monitorTestRuntime struct {
	*runtime.Fake
	mu          sync.Mutex
	observes    map[string]int
	subscribeCh chan monitorSubscribeCall
	unsupported bool
}

func newMonitorTestRuntime() *monitorTestRuntime {
	return &monitorTestRuntime{
		Fake: runtime.NewFake(), observes: map[string]int{}, subscribeCh: make(chan monitorSubscribeCall, 32),
	}
}

func (r *monitorTestRuntime) Observe(ctx context.Context, session runtime.SessionRef, query runtime.Query) (runtime.View, error) {
	if _, ok := query.(runtime.SnapshotQuery); ok {
		r.mu.Lock()
		r.observes[session.Name]++
		r.mu.Unlock()
	}
	return r.Fake.Observe(ctx, session, query)
}

func (r *monitorTestRuntime) SubscribeEvents(_ context.Context, session runtime.SessionRef, subscription runtime.EventSubscription) (runtime.EventStream, error) {
	if r.unsupported {
		return nil, &runtime.Fault{Code: runtime.CodeUnsupported, Outcome: runtime.OutcomeNotApplied, Retry: runtime.RetryNever}
	}
	stream := newMonitorTestStream()
	r.subscribeCh <- monitorSubscribeCall{session: session, panes: append([]string(nil), subscription.PaneIDs...), stream: stream}
	return stream, nil
}

func (r *monitorTestRuntime) observeCount(session string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.observes[session]
}

func waitMonitorCall(t *testing.T, calls <-chan monitorSubscribeCall, predicate func(monitorSubscribeCall) bool) monitorSubscribeCall {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case call := <-calls:
			if predicate(call) {
				return call
			}
		case <-deadline:
			t.Fatal("timed out waiting for runtime subscription")
		}
	}
}

func TestRuntimeMonitorSubscribesMembershipAcceleratesAndReconnects(t *testing.T) {
	rt := newMonitorTestRuntime()
	engine := NewEngine(nil, nil, rt)
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		engine.MonitorPush(stop, time.Second)
		close(done)
	}()

	first := waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool {
		return call.session.Name == "" && len(call.panes) == 0
	})
	second := waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool {
		return call.session.Name == "" && len(call.panes) == 1 && call.panes[0] == "w0:p1"
	})
	select {
	case <-first.stream.Done():
	case <-time.After(time.Second):
		t.Fatal("membership refresh did not replace structural-only stream")
	}
	before := rt.observeCount("")
	second.stream.events <- runtime.Event{Kind: runtime.EventAgentStatus, PaneID: "w0:p1", AgentStatus: "working"}
	deadline := time.Now().Add(500 * time.Millisecond)
	for rt.observeCount("") == before && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if rt.observeCount("") == before {
		t.Fatal("status event did not accelerate authoritative snapshot refresh")
	}
	_ = second.stream.Close()
	third := waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool {
		return call.session.Name == "" && len(call.panes) == 1
	})
	if third.stream == second.stream {
		t.Fatal("closed stream was not reconnected")
	}
	close(stop)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("monitor did not stop")
	}
}

func TestRuntimeMonitorUnsupportedFallsBackToPolling(t *testing.T) {
	rt := newMonitorTestRuntime()
	rt.unsupported = true
	engine := NewEngine(nil, nil, rt)
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		engine.MonitorPush(stop, 10*time.Millisecond)
		close(done)
	}()
	deadline := time.Now().Add(time.Second)
	for rt.observeCount("") < 2 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	close(stop)
	<-done
	if rt.observeCount("") < 2 {
		t.Fatalf("unsupported subscription did not poll: observes=%d", rt.observeCount(""))
	}
}

func TestRuntimeMonitorLeasesNamedSessionIndependently(t *testing.T) {
	rt := newMonitorTestRuntime()
	engine := NewEngine(nil, nil, rt)
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		engine.MonitorPush(stop, time.Second)
		close(done)
	}()
	name := "alpha"
	if _, err := engine.snapshot(&name); err != nil {
		t.Fatal(err)
	}
	call := waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool { return call.session.Name == name })
	if call.session.Name != name {
		t.Fatalf("named subscription crossed identity: %+v", call.session)
	}
	close(stop)
	<-done
}

type countPushTransport struct{ calls atomic.Int64 }

func (c *countPushTransport) RoundTrip(*http.Request) (*http.Response, error) {
	c.calls.Add(1)
	return &http.Response{StatusCode: http.StatusCreated, Status: "201 Created", Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
}

func TestQueuedStatusTransitionNotifiesOnceAndLaterSequenceRearms(t *testing.T) {
	rt := newMonitorTestRuntime()
	sequence := uint64(1)
	rt.Fake.Snap.Panes[0].AgentStatus = "idle"
	rt.Fake.Snap.Panes[0].AgentInstanceID = "instance"
	rt.Fake.Snap.Panes[0].StateChangeSeq = &sequence
	engine := NewEngine(nil, nil, rt)
	pub, priv := testVAPID(t)
	userPub, userAuth := testPushSubscriptionKeys(t)
	transport := &countPushTransport{}
	engine.VAPIDPublic, engine.VAPIDPrivate, engine.VAPIDSubject = pub, priv, "mailto:probe@example.invalid"
	engine.PushHTTPClient = &http.Client{Transport: transport}
	engine.PushEnabled = true
	engine.DaemonID = "daemon-test"
	engine.Devices["dev_12345678"] = &Device{ID: "dev_12345678", PushSubscriptions: []state.PushSubscription{{
		Endpoint: "https://push.example.test/one", P256DH: userPub, Auth: userAuth,
	}}}
	monitorState := sessionMonitorState{panes: map[string]monitoredPane{
		"w0:p1": {status: "idle", instanceID: "instance", stateChangeSeq: copyUint64(&sequence), pane: rt.Fake.Snap.Panes[0]},
	}}
	engine.applyRuntimeEvent(runtime.Event{Kind: runtime.EventAgentStatus, PaneID: "w0:p1", AgentStatus: "working"}, true, &monitorState, func(string, string) {})
	engine.applyRuntimeEvent(runtime.Event{Kind: runtime.EventAgentStatus, PaneID: "w0:p1", AgentStatus: "done"}, true, &monitorState, func(string, string) {})
	if calls := transport.calls.Load(); calls != 1 {
		t.Fatalf("queued working->done notifications=%d, want 1", calls)
	}

	sequence = 2
	rt.Fake.Snap.Panes[0].AgentStatus = "done"
	rt.Fake.Snap.Panes[0].StateChangeSeq = &sequence
	engine.reconcileRuntimeSession(context.Background(), runtime.DefaultSession(), true, &monitorState, func(string, string) {})
	if calls := transport.calls.Load(); calls != 1 {
		t.Fatalf("authoritative snapshot duplicated queued completion: %d", calls)
	}
	sequence = 3
	rt.Fake.Snap.Panes[0].StateChangeSeq = &sequence
	engine.reconcileRuntimeSession(context.Background(), runtime.DefaultSession(), true, &monitorState, func(string, string) {})
	if calls := transport.calls.Load(); calls != 2 {
		t.Fatalf("new completion sequence did not rearm notification: %d", calls)
	}
}

func TestSnapshotSequenceRearmsCompletionWithoutObservedWorking(t *testing.T) {
	kind, notify := pushKindForObservation("done", "done", true, false)
	if !notify || kind != PushDone {
		t.Fatalf("kind=%q notify=%v", kind, notify)
	}
	if kind, notify = pushKindForObservation("done", "done", true, true); notify || kind != "" {
		t.Fatalf("queued done was duplicated: kind=%q notify=%v", kind, notify)
	}
}

func TestObservedPaneChangeIncludesRichFacts(t *testing.T) {
	seq1, seq2 := uint64(1), uint64(2)
	ready := true
	base := monitoredPane{status: "done", instanceID: "instance", stateChangeSeq: &seq1, interactiveReady: &ready}
	changed := base
	changed.stateChangeSeq = &seq2
	if !observedPaneChanged(base, changed) {
		t.Fatal("new completion sequence was not observable")
	}
	changed = base
	changed.instanceID = "replacement"
	if !observedPaneChanged(base, changed) {
		t.Fatal("occupant replacement was not observable")
	}
}
