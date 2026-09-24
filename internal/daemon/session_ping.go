package daemon

import (
	"encoding/hex"
	"time"
)

// A single bounded health lane per epoch keeps slow Runtime calls from
// masquerading as a broken connection. Admission is after AEAD authentication.
const sessionPingQueueSize = 4

func (e *Engine) runSessionPing(s *sess) {
	// Audit fsync must never become another head-of-line blocker for Ping.
	// Keep both logging backlog and sampling rate bounded per session.
	var diagnostics chan map[string]any
	if e.Audit != nil {
		diagnostics = make(chan map[string]any, 1)
		defer close(diagnostics)
		go func() {
			for fields := range diagnostics {
				e.audit("health_ping", fields)
			}
		}()
	}
	var lastAudit time.Time
	for {
		select {
		case <-s.rpcStop:
			return
		default:
		}
		select {
		case <-s.rpcStop:
			return
		case request := <-s.pingQueue:
			e.mu.Lock()
			routeID := s.routeID
			active := s.sendEpochLive() && s.state == "established" && e.sessions[s.routeID] == s
			e.mu.Unlock()
			if !active {
				continue
			}
			started := time.Now()
			e.rpcPing(s, request.id, request.params)
			finished := time.Now()
			queued := started.Sub(request.receivedAt)
			replied := finished.Sub(started)
			interval := 30 * time.Second
			if queued >= 100*time.Millisecond || replied >= 100*time.Millisecond {
				interval = time.Second
			}
			if diagnostics == nil || finished.Sub(lastAudit) < interval {
				continue
			}
			fields := map[string]any{
				"route_id":   hex.EncodeToString(routeID[:]),
				"request_id": request.id,
				"queue_ms":   queued.Milliseconds(),
				"reply_ms":   replied.Milliseconds(),
			}
			select {
			case diagnostics <- fields:
				lastAudit = finished
			default:
			}

		}
	}
}
