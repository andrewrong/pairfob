// Per-entry V2 write pipeline gate. This is the bounded ordered window
// required by the P2 server ordering contract: at most 4 admitted write
// tickets per V2 upload, keyed by grid offset, plus a durable-prefix mirror
// advanced only after a write succeeds, under entry.mu serialization.
//
// Locking rules (frozen):
//   - Lock order is entry.mu -> pipeline.mu. Every invalidation that must
//     serialize against a disk write (cancel, write failure, timeout,
//     expiry, shutdown) takes pipeline.mu ONLY while holding entry.mu, so an
//     in-flight WriteAtV2 (which runs under entry.mu) always settles first
//     and the prefix mirror can never lag the entry's durable offset.
//     pipeline.mu is a leaf: it never takes entry.mu, the registry lock, or
//     any I/O lock. Ticket settlement on a write's success path runs under
//     entry.mu. The dispatch-path pool-refusal fallback may settle a ticket
//     without entry.mu; that is safe because the gate never calls back into
//     the entry.
//   - Admission (claimTicket) happens synchronously in the RPC dispatch path
//     BEFORE the upload goroutine is spawned, so a later StatusV2 can capture
//     every previously admitted write even if its goroutine has not started.
//     Admission never takes entry.mu: it reads only immutable entry identity
//     and this gate's prefix mirror.
//
// The gate owns no I/O and no goroutines. Waiting is done by the write
// goroutine itself (bounded, on predecessor completion channels), so there is
// no extra goroutine per wait.
package daemon

import (
	"sync"
	"time"
)

const (
	// uploadV2Window is the frozen per-entry V2 write window: at most 4
	// admitted tickets (including the active one) keyed by grid offset.
	uploadV2Window = 4
)

// uploadV2WaitLimit bounds how long an admitted successor ticket may wait
// for predecessor progress before it settles as a timeout (fail-closed). It
// is a var (not const) purely as a deterministic test seam; production value
// is 12s and tests restore it.
var uploadV2WaitLimit = 12 * time.Second

// uploadTicket is one admitted V2 write. It registers before root lookup,
// carries the grid offset and admission generation, and is settled exactly
// once (by success, failure, invalidation or timeout). done is closed
// exactly once through finish (sync.Once); waiters never send on it and no
// path ever closes it bare, so concurrent settlement can never double-close.
type uploadTicket struct {
	offset int64
	gen    uint64
	done   chan struct{}
	finish sync.Once
}

// signal closes the completion channel exactly once, regardless of which
// settlement path (owner success/failure, authority invalidation, timeout)
// reaches the ticket first.
func (t *uploadTicket) signal() {
	t.finish.Do(func() { close(t.done) })
}

// uploadPipeline is the per-entry V2 ordering gate. prefix mirrors the
// durable contiguous byte offset (advanced only after a successful write,
// while holding entry.mu, before the success ACK is sent); gen is the
// admission generation: it is bumped on invalidation so a wave failure
// starts a fresh generation and a later explicit resume (after Status
// returns the settled prefix) may admit new tickets without permanently
// poisoning the upload.
type uploadPipeline struct {
	mu      sync.Mutex
	tickets map[int64]*uploadTicket
	prefix  int64
	gen     uint64
	// changed is the admission/settlement/invalidation broadcast channel. It
	// is closed and recreated (under mu) whenever the gate's observable state
	// changes, so an out-of-order successor ticket (e.g. offset 3 admitted
	// before offsets 0/1/2 arrive) can be woken to recheck the prefix rather
	// than sleeping out the whole wait-limit. Waiters never send on it.
	changed chan struct{}
}

func newUploadPipeline() *uploadPipeline {
	return &uploadPipeline{tickets: map[int64]*uploadTicket{}, changed: make(chan struct{})}
}

// broadcastLocked marks a gate state change: it closes the current changed
// channel and replaces it so current and future waiters observe one epoch of
// changes. The caller MUST hold g.mu. It never sends; closing wakes all
// current selectors and the replacement is what the next snapshot captures.
func (g *uploadPipeline) broadcastLocked() {
	close(g.changed)
	g.changed = make(chan struct{})
}

// waitSnapshot atomically captures the state a predecessor-waiting write
// needs to recheck in one step: ticket liveness, the durable-prefix mirror
// and the current change-broadcast channel, plus the done channels of every
// lower live ticket. Empty changed is never returned (newUploadPipeline
// allocates one and every broadcast replaces it while non-nil).
type v2WaitSnapshot struct {
	live    bool
	prefix  int64
	changed chan struct{}
	lower   []chan struct{}
}

func (g *uploadPipeline) waitSnapshot(t *uploadTicket) v2WaitSnapshot {
	g.mu.Lock()
	defer g.mu.Unlock()
	snap := v2WaitSnapshot{changed: g.changed}
	if current, ok := g.tickets[t.offset]; ok && current == t {
		snap.live = true
		snap.prefix = g.prefix
	}
	for off, c := range g.tickets {
		if off < t.offset && c != t {
			snap.lower = append(snap.lower, c.done)
		}
	}
	return snap
}

// claimTicket synchronously admits one V2 write ticket at grid offset.
// offset must already be identity-checked (bounded parse, valid entry
// lookup). It refuses (ok=false, reason) without mutation when:
//   - the offset is a duplicate of a live ticket,
//   - the window already holds 4 tickets,
//   - the offset is outside [prefix, prefix + 4*chunk) (grid window).
//
// It never touches entry.mu, disk, or the registry. prefix is the caller's
// view of the durable mirror (admission passes the mirror itself).
func (g *uploadPipeline) claimTicket(offset, prefix int64, chunk int64) (t *uploadTicket, ok bool, reason string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.tickets[offset] != nil {
		return nil, false, "duplicate"
	}
	if len(g.tickets) >= uploadV2Window {
		return nil, false, "window"
	}
	if offset < g.prefix || offset >= g.prefix+int64(uploadV2Window-1)*chunk+chunk {
		return nil, false, "window"
	}
	// The caller's view of the durable prefix must match the gate's mirror;
	// a stale caller (e.g. offset below the true prefix) is outside the
	// window.
	if offset < prefix {
		return nil, false, "window"
	}
	t = &uploadTicket{offset: offset, gen: g.gen, done: make(chan struct{})}
	g.tickets[offset] = t
	g.broadcastLocked()
	return t, true, ""
}

// settleTicket removes and completes a ticket exactly once. advanceTo>0
// (success) also advances the durable-prefix mirror to the write's end
// offset. Write success calls it while holding entry.mu (entry.mu ->
// pipeline.mu order), before the success ACK is serialized, so a barrier
// waiting on t.done can only wake after the prefix moved and the entry state
// was updated. Safe to call from any exit path; double settlement is a no-op
// that still guarantees t.done is closed.
func (g *uploadPipeline) settleTicket(t *uploadTicket, advanceTo int64) {
	if t == nil {
		return
	}
	g.mu.Lock()
	current, live := g.tickets[t.offset]
	if !live || current != t {
		g.mu.Unlock()
		// Already settled, invalidated, or superseded. The ticket owner must
		// still observe done exactly once so no waiter blocks forever.
		t.signal()
		return
	}
	delete(g.tickets, t.offset)
	if advanceTo > g.prefix {
		g.prefix = advanceTo
	}
	g.broadcastLocked()
	g.mu.Unlock()
	t.signal()
}

// invalidateAll wakes and drops EVERY admitted ticket WITHOUT writing, and
// bumps the admission generation. It is the authority invalidation used by
// Cancel, expiry and shutdown: callers MUST hold entry.mu (entry.mu ->
// pipeline.mu) so the invalidation is serialized against a write currently
// running under entry.mu. Tickets settled later by their owner goroutines
// become identity no-ops, but their done channel is already closed.
func (g *uploadPipeline) invalidateAll() {
	g.mu.Lock()
	g.gen++
	old := g.tickets
	g.tickets = map[int64]*uploadTicket{}
	g.broadcastLocked()
	g.mu.Unlock()
	for _, t := range old {
		t.signal()
	}
}

// invalidateWave invalidates tickets on behalf of a ticket OWNER that failed
// (disk error, authorization/root failure, bounded wait timeout). It is
// conditional on identity: the wave is dropped ONLY if trigger is still a
// currently-live ticket at its offset in the current generation. A stale
// handler whose wave was already invalidated by cancel/expiry/close/timeout
// (and after which a newer resume wave may have been admitted) is a no-op
// and can never invalidate the newer generation. The trigger ticket itself
// is removed and signaled when current, so every exit still settles exactly
// once. Disk-failure callers hold entry.mu; timeout/auth-failure callers
// acquire entry.mu around this call (failV2Wave), so this never races an
// in-flight predecessor settle in a way that could lag the prefix mirror.
func (g *uploadPipeline) invalidateWave(trigger *uploadTicket) {
	if trigger == nil {
		return
	}
	g.mu.Lock()
	current, ok := g.tickets[trigger.offset]
	if !ok || current != trigger {
		g.mu.Unlock()
		trigger.signal()
		return
	}
	g.gen++
	old := g.tickets
	g.tickets = map[int64]*uploadTicket{}
	g.broadcastLocked()
	g.mu.Unlock()
	for _, t := range old {
		t.signal()
	}
}

// captureTickets returns completion channels for every currently admitted
// ticket (snapshot, up to 4). StatusV2/CommitV2 admission calls this
// synchronously in the dispatch path so pre-barrier writes cannot mutate
// after a successful Status snapshot unnoticed: every captured ticket settles
// (under entry.mu serialization) before the barrier wait returns. Order is
// ascending offset.
func (g *uploadPipeline) captureTickets() []chan struct{} {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make([]chan struct{}, 0, len(g.tickets))
	offsets := make([]int64, 0, len(g.tickets))
	for off := range g.tickets {
		offsets = append(offsets, off)
	}
	// insertion-free ascending sort for <=4 entries
	for i := 1; i < len(offsets); i++ {
		for j := i; j > 0 && offsets[j] < offsets[j-1]; j-- {
			offsets[j], offsets[j-1] = offsets[j-1], offsets[j]
		}
	}
	for _, off := range offsets {
		out = append(out, g.tickets[off].done)
	}
	return out
}

// live reports whether the ticket is still the current-generation admitted
// ticket for its offset. It takes the leaf pipeline mutex alone; write
// handlers call it while holding entry.mu (entry.mu -> pipeline.mu)
// immediately before the disk mutation.
func (g *uploadPipeline) live(t *uploadTicket) bool {
	if t == nil {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	current, ok := g.tickets[t.offset]
	return ok && current == t
}

// prefixSnapshot returns the durable-prefix mirror (for admission bounds).
func (g *uploadPipeline) prefixSnapshot() int64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.prefix
}

// waitChans waits bounded for every captured channel to be closed, or
// returns false at the deadline. No extra goroutine: the caller blocks.
func waitChans(chans []chan struct{}, deadline time.Duration) bool {
	timer := time.NewTimer(deadline)
	defer timer.Stop()
	for _, ch := range chans {
		select {
		case <-ch:
		case <-timer.C:
			return false
		}
	}
	return true
}
