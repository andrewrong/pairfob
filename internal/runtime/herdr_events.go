package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"sync"
	"time"
)

const (
	herdrEventRequestID = "pairfob-events"
	maxEventPanes       = 1024
	maxEventFrameBytes  = 512 << 10
)

var structuralSubscriptions = []string{
	"workspace.created", "workspace.updated", "workspace.metadata_updated", "workspace.renamed",
	"workspace.moved", "workspace.reordered", "workspace.closed", "workspace.focused",
	"worktree.created", "worktree.opened", "worktree.removed",
	"tab.created", "tab.closed", "tab.focused", "tab.renamed", "tab.moved",
	"pane.created", "pane.closed", "pane.updated", "pane.focused", "pane.moved", "pane.exited",
	"pane.agent_detected", "layout.updated",
}

var structuralEvents = func() map[string]struct{} {
	out := make(map[string]struct{}, len(structuralSubscriptions))
	for _, event := range structuralSubscriptions {
		out[eventWireName(event)] = struct{}{}
	}
	return out
}()

// herdrEventStream has exactly one reader. Closing its context interrupts a
// blocked Unix socket read; the reader alone closes the public channels.
type herdrEventStream struct {
	conn   net.Conn
	events chan Event
	done   chan struct{}
	cancel context.CancelFunc

	closeOnce sync.Once
	mu        sync.Mutex
	err       error
}

func (s *herdrEventStream) Events() <-chan Event  { return s.events }
func (s *herdrEventStream) Done() <-chan struct{} { return s.done }

func (s *herdrEventStream) Err() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.err
}

func (s *herdrEventStream) Close() error {
	s.closeOnce.Do(func() {
		s.cancel()
		_ = s.conn.Close()
	})
	return nil
}

func (s *herdrEventStream) setErr(err error) {
	s.mu.Lock()
	s.err = err
	s.mu.Unlock()
}

// SubscribeEvents opens a connection dedicated to event delivery. The normal
// RPC connection remains one-request/one-response and is never shared.
func (h *Herdr) SubscribeEvents(ctx context.Context, session SessionRef, subscription EventSubscription) (EventStream, error) {
	paneIDs, err := normalizeEventPaneIDs(subscription.PaneIDs)
	if err != nil {
		return nil, err
	}
	socket, err := h.socketFor(session)
	if err != nil {
		return nil, err
	}
	dialer := net.Dialer{Timeout: 2 * time.Second}
	conn, err := dialer.DialContext(ctx, "unix", socket)
	if err != nil {
		return nil, transportFault("events.subscribe", err, false, false)
	}
	failed := true
	defer func() {
		if failed {
			_ = conn.Close()
		}
	}()
	ackDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-ackDone:
		}
	}()
	defer close(ackDone)

	request := map[string]any{"id": herdrEventRequestID, "method": "events.subscribe", "params": map[string]any{
		"subscriptions": eventSubscriptions(paneIDs),
	}}
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, responseFault("events.subscribe", "failed to encode Herdr subscription", err, false)
	}
	deadline := time.Now().Add(5 * time.Second)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	_ = conn.SetDeadline(deadline)
	written, err := conn.Write(append(encoded, '\n'))
	if err != nil {
		return nil, transportFault("events.subscribe", err, false, written > 0)
	}
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), maxEventFrameBytes)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return nil, transportFault("events.subscribe", err, false, true)
		}
		return nil, transportFault("events.subscribe", io.EOF, false, true)
	}
	if err := validateSubscriptionACK(scanner.Bytes()); err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	streamContext, cancel := context.WithCancel(ctx)
	stream := &herdrEventStream{conn: conn, events: make(chan Event, 64), done: make(chan struct{}), cancel: cancel}
	failed = false
	go stream.read(streamContext, scanner)
	return stream, nil
}

func normalizeEventPaneIDs(values []string) ([]string, error) {
	if len(values) > maxEventPanes {
		return nil, invalidFault("events.subscribe", "too many event pane ids")
	}
	seen := make(map[string]struct{}, len(values))
	for _, paneID := range values {
		if !validResourceID.MatchString(paneID) {
			return nil, invalidFault("events.subscribe", "invalid event pane id")
		}
		seen[paneID] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for paneID := range seen {
		out = append(out, paneID)
	}
	sort.Strings(out)
	return out, nil
}

func eventSubscriptions(paneIDs []string) []map[string]any {
	out := make([]map[string]any, 0, len(structuralSubscriptions)+len(paneIDs))
	for _, event := range structuralSubscriptions {
		out = append(out, map[string]any{"type": event})
	}
	for _, paneID := range paneIDs {
		out = append(out, map[string]any{"type": "pane.agent_status_changed", "pane_id": paneID})
	}
	return out
}

func validateSubscriptionACK(line []byte) error {
	var envelope rpcEnv
	if err := decodeEventJSON(line, &envelope); err != nil {
		return responseFault("events.subscribe", "invalid Herdr subscription acknowledgement", err, false)
	}
	if envelope.ID != herdrEventRequestID || (envelope.Error == nil) == (len(envelope.Result) == 0 || string(envelope.Result) == "null") {
		return responseFault("events.subscribe", "invalid Herdr subscription acknowledgement", nil, false)
	}
	if envelope.Error != nil {
		return herdrFault("events.subscribe", envelope.Error.Code, envelope.Error.Message)
	}
	var result struct {
		Type string `json:"type"`
	}
	if err := decodeEventJSON(envelope.Result, &result); err != nil || result.Type != "subscription_started" {
		return responseFault("events.subscribe", "invalid Herdr subscription acknowledgement", err, false)
	}
	return nil
}

func (s *herdrEventStream) read(ctx context.Context, scanner *bufio.Scanner) {
	readerDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = s.conn.Close()
		case <-readerDone:
		}
	}()
	defer func() {
		close(readerDone)
		s.cancel()
		_ = s.conn.Close()
		close(s.events)
		close(s.done)
	}()
	for scanner.Scan() {
		event, err := decodeHerdrEvent(scanner.Bytes())
		if err != nil {
			s.setErr(err)
			return
		}
		select {
		case s.events <- event:
		case <-ctx.Done():
			return
		default:
			s.setErr(responseFault("events.subscribe", "Herdr event buffer overflow", nil, false))
			return
		}
	}
	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		s.setErr(responseFault("events.subscribe", "invalid Herdr event stream", err, false))
	} else if ctx.Err() == nil {
		s.setErr(transportFault("events.subscribe", io.EOF, false, true))
	}
}

func decodeHerdrEvent(line []byte) (Event, error) {
	var envelope struct {
		Event string          `json:"event"`
		Data  json.RawMessage `json:"data"`
	}
	if err := decodeEventJSON(line, &envelope); err != nil || envelope.Event == "" || len(envelope.Data) == 0 {
		return Event{}, responseFault("events.subscribe", "invalid Herdr event envelope", err, false)
	}
	if envelope.Event == "pane.agent_status_changed" {
		var data struct {
			PaneID      string `json:"pane_id"`
			WorkspaceID string `json:"workspace_id"`
			AgentStatus string `json:"agent_status"`
		}
		if err := json.Unmarshal(envelope.Data, &data); err != nil || !validResourceID.MatchString(data.PaneID) ||
			!validResourceID.MatchString(data.WorkspaceID) || !validAgentStatus(data.AgentStatus) {
			return Event{}, responseFault("events.subscribe", "invalid Herdr agent status event", err, false)
		}
		return Event{Kind: EventAgentStatus, PaneID: data.PaneID, AgentStatus: data.AgentStatus}, nil
	}
	if _, ok := structuralEvents[envelope.Event]; !ok {
		return Event{}, responseFault("events.subscribe", "unexpected Herdr event", nil, false)
	}
	var data struct {
		Type   string `json:"type"`
		PaneID string `json:"pane_id"`
		Pane   *struct {
			PaneID string `json:"pane_id"`
		} `json:"pane"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil || data.Type != envelope.Event {
		return Event{}, responseFault("events.subscribe", "invalid Herdr structural event", err, false)
	}
	paneID := data.PaneID
	if data.Pane != nil {
		paneID = data.Pane.PaneID
	}
	if paneID != "" && !validResourceID.MatchString(paneID) {
		return Event{}, responseFault("events.subscribe", "invalid Herdr event pane id", nil, false)
	}
	return Event{Kind: EventStructure, PaneID: paneID}, nil
}

func decodeEventJSON(data []byte, dst any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("multiple JSON values")
		}
		return err
	}
	return nil
}

func eventWireName(subscription string) string {
	out := []byte(subscription)
	for i := range out {
		if out[i] == '.' {
			out[i] = '_'
		}
	}
	return string(out)
}
