package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"sync"
	"testing"
	"time"
)

type eventFixture struct {
	socket   string
	listener net.Listener
	requests chan scriptedRequest
	closed   chan struct{}
	once     sync.Once
}

func startEventFixture(t *testing.T, serve func(net.Conn, scriptedRequest)) *eventFixture {
	t.Helper()
	socket := shortTestSocket(t)
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &eventFixture{socket: socket, listener: listener, requests: make(chan scriptedRequest, 8), closed: make(chan struct{})}
	t.Cleanup(func() { fixture.close() })
	go func() {
		defer close(fixture.closed)
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				scanner := bufio.NewScanner(conn)
				if !scanner.Scan() {
					_ = conn.Close()
					return
				}
				var request scriptedRequest
				if json.Unmarshal(scanner.Bytes(), &request) != nil {
					_ = conn.Close()
					return
				}
				fixture.requests <- request
				serve(conn, request)
			}()
		}
	}()
	return fixture
}

func (f *eventFixture) close() {
	f.once.Do(func() {
		_ = f.listener.Close()
		_ = os.Remove(f.socket)
		<-f.closed
	})
}

func writeEventLine(conn net.Conn, value any) {
	raw, _ := json.Marshal(value)
	_, _ = conn.Write(append(raw, '\n'))
}

func TestHerdrSubscribeEventsACKFramingAndCancel(t *testing.T) {
	connectionClosed := make(chan struct{})
	fixture := startEventFixture(t, func(conn net.Conn, request scriptedRequest) {
		defer close(connectionClosed)
		defer conn.Close()
		writeEventLine(conn, map[string]any{"id": request.ID, "result": map[string]any{"type": "subscription_started"}})
		writeEventLine(conn, map[string]any{
			"event": "pane.agent_status_changed",
			"data":  map[string]any{"pane_id": "w1:p1", "workspace_id": "w1", "agent_status": "done"},
		})
		writeEventLine(conn, map[string]any{
			"event": "pane_updated",
			"data":  map[string]any{"type": "pane_updated", "pane": map[string]any{"pane_id": "w1:p1"}},
		})
		buffer := make([]byte, 1)
		_, _ = conn.Read(buffer)
	})
	ctx, cancel := context.WithCancel(context.Background())
	stream, err := NewHerdr(fixture.socket).SubscribeEvents(ctx, DefaultSession(), EventSubscription{PaneIDs: []string{"w1:p1", "w1:p1"}})
	if err != nil {
		t.Fatal(err)
	}
	request := <-fixture.requests
	if request.Method != "events.subscribe" || request.ID != herdrEventRequestID {
		t.Fatalf("request=%+v", request)
	}
	var params struct {
		Subscriptions []struct {
			Type   string `json:"type"`
			PaneID string `json:"pane_id"`
		} `json:"subscriptions"`
	}
	if err := json.Unmarshal(request.Params, &params); err != nil {
		t.Fatal(err)
	}
	statusCount, paneUpdated := 0, false
	for _, subscription := range params.Subscriptions {
		if subscription.Type == "pane.agent_status_changed" && subscription.PaneID == "w1:p1" {
			statusCount++
		}
		if subscription.Type == "pane.updated" {
			paneUpdated = true
		}
	}
	if statusCount != 1 || !paneUpdated {
		t.Fatalf("subscriptions=%+v", params.Subscriptions)
	}
	first := <-stream.Events()
	second := <-stream.Events()
	if first.Kind != EventAgentStatus || first.PaneID != "w1:p1" || first.AgentStatus != "done" {
		t.Fatalf("status event=%+v", first)
	}
	if second.Kind != EventStructure || second.PaneID != "w1:p1" {
		t.Fatalf("structural event=%+v", second)
	}
	cancel()
	select {
	case <-stream.Done():
	case <-time.After(time.Second):
		t.Fatal("cancellation did not close event stream")
	}
	select {
	case <-connectionClosed:
	case <-time.After(time.Second):
		t.Fatal("cancellation did not close subscription socket")
	}
}

func TestHerdrSubscribeEventsCancellationInterruptsACK(t *testing.T) {
	serverSawClose := make(chan struct{})
	fixture := startEventFixture(t, func(conn net.Conn, _ scriptedRequest) {
		defer close(serverSawClose)
		defer conn.Close()
		buffer := make([]byte, 1)
		_, _ = conn.Read(buffer)
	})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := NewHerdr(fixture.socket).SubscribeEvents(ctx, DefaultSession(), EventSubscription{})
		result <- err
	}()
	<-fixture.requests
	cancel()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("cancelled acknowledgement wait succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not interrupt acknowledgement read")
	}
	select {
	case <-serverSawClose:
	case <-time.After(time.Second):
		t.Fatal("cancelled acknowledgement did not close socket")
	}
}

func TestHerdrSubscribeEventsRejectsWrongACK(t *testing.T) {
	fixture := startEventFixture(t, func(conn net.Conn, _ scriptedRequest) {
		defer conn.Close()
		writeEventLine(conn, map[string]any{"id": "other", "result": map[string]any{"type": "subscription_started"}})
	})
	if _, err := NewHerdr(fixture.socket).SubscribeEvents(context.Background(), DefaultSession(), EventSubscription{}); err == nil {
		t.Fatal("mismatched subscription acknowledgement was accepted")
	}
}

func TestHerdrSubscribeEventsRejectsMalformedEvent(t *testing.T) {
	fixture := startEventFixture(t, func(conn net.Conn, request scriptedRequest) {
		defer conn.Close()
		writeEventLine(conn, map[string]any{"id": request.ID, "result": map[string]any{"type": "subscription_started"}})
		// Subscription events require pane_id in data, not only on an RPC-style wrapper.
		writeEventLine(conn, map[string]any{
			"event": "pane.agent_status_changed",
			"data":  map[string]any{"workspace_id": "w1", "agent_status": "done"},
		})
	})
	stream, err := NewHerdr(fixture.socket).SubscribeEvents(context.Background(), DefaultSession(), EventSubscription{PaneIDs: []string{"w1:p1"}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-stream.Done():
		if stream.Err() == nil {
			t.Fatal("malformed event closed stream without an error")
		}
	case <-time.After(time.Second):
		t.Fatal("malformed event did not close stream")
	}
}

func TestHerdrSubscribeEventsUnsupported(t *testing.T) {
	fixture := startEventFixture(t, func(conn net.Conn, request scriptedRequest) {
		defer conn.Close()
		writeEventLine(conn, map[string]any{"id": request.ID, "error": map[string]any{"code": "unsupported", "message": "not enabled"}})
	})
	_, err := NewHerdr(fixture.socket).SubscribeEvents(context.Background(), DefaultSession(), EventSubscription{})
	fault, ok := AsFault(err)
	if !ok || fault.Code != CodeUnsupported {
		t.Fatalf("fault=%+v err=%v", fault, err)
	}
}
