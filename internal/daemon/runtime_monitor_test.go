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
	at      time.Time
}

type monitorTestRuntime struct {
	*runtime.Fake
	mu               sync.Mutex
	observes         map[string]int
	subscribeCh      chan monitorSubscribeCall
	unsupported      bool
	closeImmediately bool
	observeErr       error
	snapshot         *runtime.Snapshot
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
		err, snapshot := r.observeErr, r.snapshot
		r.mu.Unlock()
		if err != nil {
			return nil, err
		}
		if snapshot != nil {
			copy := *snapshot
			copy.Panes = append([]runtime.Pane(nil), snapshot.Panes...)
			return runtime.SnapshotView{Snapshot: copy}, nil
		}
	}
	return r.Fake.Observe(ctx, session, query)
}

func (r *monitorTestRuntime) setSnapshot(snapshot runtime.Snapshot) {
	r.mu.Lock()
	r.snapshot = &snapshot
	r.mu.Unlock()
}

func (r *monitorTestRuntime) SubscribeEvents(_ context.Context, session runtime.SessionRef, subscription runtime.EventSubscription) (runtime.EventStream, error) {
	if r.unsupported {
		return nil, &runtime.Fault{Code: runtime.CodeUnsupported, Outcome: runtime.OutcomeNotApplied, Retry: runtime.RetryNever}
	}
	stream := newMonitorTestStream()
	if r.closeImmediately {
		_ = stream.Close()
	}
	r.subscribeCh <- monitorSubscribeCall{
		session: session, panes: append([]string(nil), subscription.PaneIDs...), stream: stream, at: time.Now(),
	}
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

func TestRuntimeMonitorCancelsBoundedPushDeliveryOnShutdown(t *testing.T) {
	rt := newMonitorTestRuntime()
	sequence1 := uint64(1)
	pane := rt.Fake.Snap.Panes[0]
	pane.AgentStatus, pane.AgentInstanceID, pane.StateChangeSeq = "idle", "instance", &sequence1
	snapshot := rt.Fake.Snap
	snapshot.Panes = []runtime.Pane{pane}
	rt.setSnapshot(snapshot)

	engine := NewEngine(nil, nil, rt)
	ref, appendEvent := taskActivityFixture(t, engine)
	pane.AgentSession = ref
	pub, priv := testVAPID(t)
	userPub, userAuth := testPushSubscriptionKeys(t)
	started := make(chan struct{})
	engine.VAPIDPublic, engine.VAPIDPrivate, engine.VAPIDSubject = pub, priv, "mailto:probe@example.invalid"
	engine.PushHTTPClient = &http.Client{Transport: &holdRoundTripper{started: started}}
	engine.PushEnabled = true
	engine.DaemonID = "daemon-test"
	engine.Devices["dev_12345678"] = &Device{ID: "dev_12345678", PushSubscriptions: []state.PushSubscription{{
		Endpoint: "https://push.example.test/one", P256DH: userPub, Auth: userAuth,
	}}}
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		engine.MonitorPush(stop, time.Second)
		close(done)
	}()
	_ = waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool { return len(call.panes) == 0 })
	stream := waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool { return len(call.panes) == 1 })

	appendEvent(`{"type":"event_msg","payload":{"type":"task_started"}}`)
	sequence2 := uint64(2)
	pane.AgentStatus, pane.StateChangeSeq = "working", &sequence2
	snapshot.Panes = []runtime.Pane{pane}
	rt.setSnapshot(snapshot)
	beforeWorking := rt.observeCount("")
	stream.stream.events <- runtime.Event{Kind: runtime.EventAgentStatus, PaneID: pane.PaneID, AgentStatus: "done"}
	deadline := time.Now().Add(time.Second)
	for rt.observeCount("") == beforeWorking && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if rt.observeCount("") == beforeWorking {
		t.Fatal("working snapshot was not reconciled")
	}
	appendEvent(`{"type":"event_msg","payload":{"type":"task_complete"}}`)
	sequence3 := uint64(3)
	pane.AgentStatus, pane.StateChangeSeq = "done", &sequence3
	snapshot.Panes = []runtime.Pane{pane}
	rt.setSnapshot(snapshot)
	stream.stream.events <- runtime.Event{Kind: runtime.EventAgentStatus, PaneID: pane.PaneID, AgentStatus: "done"}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("push delivery did not start")
	}
	close(stop)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("monitor shutdown did not cancel push delivery")
	}
}

func TestRuntimeMonitorBacksOffAfterStreamEOF(t *testing.T) {
	rt := newMonitorTestRuntime()
	rt.closeImmediately = true
	engine := NewEngine(nil, nil, rt)
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		engine.MonitorPush(stop, 40*time.Millisecond)
		close(done)
	}()
	_ = waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool { return len(call.panes) == 0 })
	second := waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool { return len(call.panes) == 1 })
	third := waitMonitorCall(t, rt.subscribeCh, func(call monitorSubscribeCall) bool { return len(call.panes) == 1 })
	close(stop)
	<-done
	if elapsed := third.at.Sub(second.at); elapsed < 30*time.Millisecond {
		t.Fatalf("stream EOF caused a busy reconnect loop: %v", elapsed)
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

func TestNamedRuntimeFailureDoesNotEmitDefaultAvailability(t *testing.T) {
	rt := newMonitorTestRuntime()
	rt.observeErr = &runtime.Fault{Code: runtime.CodeOffline, Outcome: runtime.OutcomeNotApplied, Retry: runtime.RetryReadSafe}
	engine := NewEngine(nil, nil, rt)
	var namedPokes []string
	namedState := sessionMonitorState{panes: map[string]monitoredPane{}}
	engine.reconcileRuntimeSession(context.Background(), runtime.NamedSession("alpha"), false, &namedState, func(reason, _ string) {
		namedPokes = append(namedPokes, reason)
	}, func(HerdPush) {})
	if len(namedPokes) != 0 {
		t.Fatalf("named runtime emitted default availability: %v", namedPokes)
	}
	var defaultPokes []string
	defaultState := sessionMonitorState{panes: map[string]monitoredPane{}}
	engine.reconcileRuntimeSession(context.Background(), runtime.DefaultSession(), true, &defaultState, func(reason, _ string) {
		defaultPokes = append(defaultPokes, reason)
	}, func(HerdPush) {})
	if len(defaultPokes) != 1 || defaultPokes[0] != "herdr_offline" {
		t.Fatalf("default availability pokes=%v", defaultPokes)
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

func TestStatusEventOnlyInvalidatesAndNewSnapshotSequenceRearms(t *testing.T) {
	rt := newMonitorTestRuntime()
	sequence := uint64(1)
	oldPane := rt.Fake.Snap.Panes[0]
	oldPane.AgentStatus = "done"
	oldPane.AgentInstanceID = "old-instance"
	oldPane.StateChangeSeq = &sequence
	engine := NewEngine(nil, nil, rt)
	ref, appendEvent := taskActivityFixture(t, engine)
	oldPane.AgentSession = ref
	appendEvent(`{"type":"event_msg","payload":{"type":"task_complete"}}`)
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
		"w0:p1": {status: "done", instanceID: "old-instance", stateChangeSeq: copyUint64(&sequence), pane: oldPane},
	}}
	pokes := 0
	engine.applyRuntimeEvent(runtime.Event{Kind: runtime.EventAgentStatus, PaneID: "w0:p1", AgentStatus: "working"}, func(string, string) { pokes++ })
	if monitorState.panes["w0:p1"].status != "done" || transport.calls.Load() != 0 || pokes != 1 {
		t.Fatalf("unversioned event changed authority: state=%+v pushes=%d pokes=%d", monitorState.panes["w0:p1"], transport.calls.Load(), pokes)
	}

	sequence = 2
	newPane := oldPane
	newPane.AgentInstanceID = "new-instance"
	newPane.StateChangeSeq = &sequence
	rt.setSnapshot(runtime.Snapshot{Panes: []runtime.Pane{newPane}})
	emitPush := func(event HerdPush) { _ = engine.NotifyHerd(event) }
	engine.reconcileRuntimeSession(context.Background(), runtime.DefaultSession(), true, &monitorState, func(string, string) {}, emitPush)
	if calls := transport.calls.Load(); calls != 0 {
		t.Fatalf("stale event notified a replacement occupant: %d", calls)
	}

	sequence = 3
	appendEvent(`{"type":"event_msg","payload":{"type":"task_complete"}}`)
	newPane.StateChangeSeq = &sequence
	rt.setSnapshot(runtime.Snapshot{Panes: []runtime.Pane{newPane}})
	engine.reconcileRuntimeSession(context.Background(), runtime.DefaultSession(), true, &monitorState, func(string, string) {}, emitPush)
	if calls := transport.calls.Load(); calls != 1 {
		t.Fatalf("same-status completion sequence did not rearm: %d", calls)
	}
	engine.reconcileRuntimeSession(context.Background(), runtime.DefaultSession(), true, &monitorState, func(string, string) {}, emitPush)
	if calls := transport.calls.Load(); calls != 1 {
		t.Fatalf("unchanged authoritative snapshot duplicated notification: %d", calls)
	}
	// Native turn records can advance before the runtime status sequence does.
	appendEvent(`{"type":"event_msg","payload":{"type":"task_started"}}`)
	engine.reconcileRuntimeSession(context.Background(), runtime.DefaultSession(), true, &monitorState, func(string, string) {}, emitPush)
	appendEvent(`{"type":"event_msg","payload":{"type":"task_complete"}}`)
	engine.reconcileRuntimeSession(context.Background(), runtime.DefaultSession(), true, &monitorState, func(string, string) {}, emitPush)
	if calls := transport.calls.Load(); calls != 2 {
		t.Fatalf("new task was suppressed by an unchanged runtime sequence: %d", calls)
	}
}

func TestSnapshotSequenceRearmsCompletionWithoutObservedWorking(t *testing.T) {
	kind, notify := pushKindForObservation("done", "done", true)
	if !notify || kind != PushDone {
		t.Fatalf("kind=%q notify=%v", kind, notify)
	}
	if kind, notify = pushKindForObservation("done", "done", false); notify || kind != "" {
		t.Fatalf("unchanged done snapshot notified: kind=%q notify=%v", kind, notify)
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
