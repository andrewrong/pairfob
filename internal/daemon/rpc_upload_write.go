// Upload write path: WorkspaceUploadWrite (legacy, 32 KiB chunks) and
// WorkspaceUploadWriteV2 (128 KiB chunks, bounded ordered pipeline). Legacy
// writes share the exact sequential offset, binding, receipt and durability
// semantics. V2 writes go through the per-entry pipeline gate: admission
// happened synchronously in the dispatch path (ticket already claimed);
// the goroutine waits bounded on predecessor progress, re-checks ticket
// validity immediately before WriteAtV2, snapshots the success receipt
// under the entry lock with its OWN end offset, and only then settles the
// ticket and replies. The entry's immutable protocol version is enforced
// under the entry lock so a cross-version write can never land bytes.
package daemon

import (
	"encoding/json"
	"time"

	"pairfob/internal/workspace"
)

type timeDuration = time.Duration

var timeAfter = time.After

func (e *Engine) rpcUploadWrite(s *sess, id string, params json.RawMessage, v2 bool, adm uploadV2Admission) {
	if v2 {
		e.rpcUploadWriteV2(s, id, params, adm)
		return
	}
	e.rpcUploadWriteLegacy(s, id, params)
}

func (e *Engine) rpcUploadWriteLegacy(s *sess, id string, params json.RawMessage) {
	var p struct {
		workspacePaneParams
		UploadID    string `json:"upload_id"`
		OperationID string `json:"operation_id"`
		Offset      *int64 `json:"offset"`
		DataB64     string `json:"data_b64"`
	}
	if badParams(params, &p) || !uploadIDPattern.MatchString(p.UploadID) || !operationName.MatchString(p.OperationID) || invalidSession(p.Session) || !validID(p.PaneID) || p.Offset == nil || *p.Offset < 0 {
		e.replyErr(s, id, "invalid_argument", "invalid upload write request")
		return
	}
	data, err := decodeUploadDataBounded(p.DataB64, uploadChunkBytes)
	if err != nil {
		e.replyErr(s, id, "invalid_argument", "invalid upload chunk encoding")
		return
	}
	entry := e.uploads.lookup(s.deviceID, p.UploadID)
	if entry == nil {
		e.replyErr(s, id, "workspace_not_found", "upload handle is no longer available")
		return
	}
	if !e.bindPhase(s, id, p.workspacePaneParams, entry, true) {
		return
	}
	entry.mu.Lock()
	if e.refuseIfExpired(s, id, entry) {
		entry.mu.Unlock()
		return
	}
	defer entry.mu.Unlock()
	if entry.v2 {
		e.replyErr(s, id, "conflict", "upload was begun with a different upload protocol version")
		return
	}
	if entry.state != uploadStateUploading {
		e.replyUploadErr(s, id, workspace.ErrConflict)
		return
	}
	fingerprint, ferr := uploadFingerprint("write", struct {
		Offset int64  `json:"offset"`
		Length int    `json:"length"`
		SHA256 string `json:"sha256"`
	}{*p.Offset, len(data), sha256hex(data)})
	if ferr != nil {
		e.replyErr(s, id, "internal", "could not fingerprint upload write")
		return
	}
	cached, perr, _ := entry.replayOp(p.OperationID, fingerprint)
	if perr != nil {
		e.replyUploadErr(s, id, perr)
		return
	}
	if cached != nil {
		e.reply(s, id, cached)
		return
	}
	if entry.stage == nil || entry.offset != *p.Offset {
		e.replyUploadErr(s, id, workspace.ErrConflict)
		return
	}
	if werr := entry.stage.WriteAt(*p.Offset, data); werr != nil {
		entry.recordOpError(p.OperationID, fingerprint, werr)
		e.replyUploadErr(s, id, werr)
		return
	}
	entry.offset = entry.stage.Wrote()
	result := e.uploadResult(entry)
	entry.recordOpSuccess(p.OperationID, fingerprint, result)
	e.reply(s, id, result)
}

// rpcUploadWriteV2 executes an admitted V2 write. The ticket was claimed
// synchronously in the dispatch path (adm.ticket), before this goroutine
// existed; adm.ticket is nil for the bounded same-operation redelivery path
// (claim refused because the offset is live/settled, but the operation_id
// already has a recorded outcome), which may ONLY replay its receipt here.
//
// Ordering is the P2 safety contract:
//   - bounded wait for predecessor tickets (no extra goroutine);
//   - fresh authenticated device/live-session/pane/root binding;
//   - under entry.mu (held across the disk mutation): expired/version/state
//     checks, the final live-session and live-ticket checks immediately
//     before IO, then exactly one WriteAtV2;
//   - on success the entry offset, receipt and the pipeline durable prefix
//     are all advanced/settled under entry.mu -> pipeline.mu BEFORE the
//     entry lock is released and the success ACK is sent, so a StatusV2
//     barrier waiting on this ticket wakes only after the state it reads is
//     settled, and a later-completing write can never leak into this
//     receipt (the receipt is copied with this write's own end offset);
//   - on failure the wave is conditionally invalidated under the same lock
//     (a stale handler never touches a newer resume wave); every other exit
//     invalidates/settles via invalidateV2Wave, which takes entry.mu first
//     so an in-flight predecessor's prefix can never be lost.
func (e *Engine) rpcUploadWriteV2(s *sess, id string, params json.RawMessage, adm uploadV2Admission) {
	entry := adm.entry
	ticket := adm.ticket
	if entry == nil || entry.pipeline == nil {
		// Defensive: admission must have produced a V2 entry. Never write.
		e.replyErr(s, id, "internal", "upload write admission was lost")
		return
	}

	var p struct {
		workspacePaneParams
		UploadID    string `json:"upload_id"`
		OperationID string `json:"operation_id"`
		Offset      *int64 `json:"offset"`
		DataB64     string `json:"data_b64"`
	}
	if badParams(params, &p) || !uploadIDPattern.MatchString(p.UploadID) || !operationName.MatchString(p.OperationID) || invalidSession(p.Session) || !validID(p.PaneID) || p.Offset == nil || *p.Offset < 0 {
		e.invalidateV2Wave(entry, ticket)
		e.replyErr(s, id, "invalid_argument", "invalid upload write request")
		return
	}
	data, err := decodeUploadDataBounded(p.DataB64, uploadChunkBytesV2)
	if err != nil {
		e.invalidateV2Wave(entry, ticket)
		e.replyErr(s, id, "invalid_argument", "invalid upload chunk encoding")
		return
	}
	if entry.uploadID != p.UploadID || (ticket != nil && *p.Offset != ticket.offset) {
		e.invalidateV2Wave(entry, ticket)
		e.replyErr(s, id, "invalid_argument", "upload write identity changed after admission")
		return
	}

	// Bounded wait for predecessor progress: an offset above the durable
	// prefix waits on the ticket wave, with no extra goroutine. A wait
	// timeout or an external invalidation (cancel/expiry/close/predecessor
	// failure) fails closed: the wave (if this ticket is still current) is
	// dropped under entry.mu serialization, never advancing a gap.
	if ticket != nil && !e.awaitV2Predecessors(entry, ticket) {
		e.invalidateV2Wave(entry, ticket)
		e.replyErr(s, id, "conflict", "write window timed out waiting for the previous chunk")
		return
	}

	// Ownership/binding/root authority (fresh per write; may share D's
	// in-flight snapshot, never a completed cache).
	if !e.bindPhase(s, id, p.workspacePaneParams, entry, true) {
		e.invalidateV2Wave(entry, ticket)
		return
	}
	// Pure fingerprint computation stays outside the entry critical section.
	fingerprint, ferr := uploadFingerprint("write", struct {
		Offset int64  `json:"offset"`
		Length int    `json:"length"`
		SHA256 string `json:"sha256"`
	}{*p.Offset, len(data), sha256hex(data)})
	if ferr != nil {
		e.invalidateV2Wave(entry, ticket)
		e.replyErr(s, id, "internal", "could not fingerprint upload write")
		return
	}

	entry.mu.Lock()
	if e.refuseIfExpired(s, id, entry) {
		entry.mu.Unlock()
		e.invalidateV2Wave(entry, ticket)
		return
	}
	if entry.v2 != true || entry.state != uploadStateUploading {
		entry.mu.Unlock()
		e.invalidateV2Wave(entry, ticket)
		e.replyUploadErr(s, id, workspace.ErrConflict)
		return
	}
	// Final live-session check immediately before the disk mutation: a
	// session retired during root lookup can never write.
	if !s.liveDevice(e) {
		entry.mu.Unlock()
		e.invalidateV2Wave(entry, ticket)
		e.replyErr(s, id, "forbidden", "session is no longer established")
		return
	}
	cached, perr, _ := entry.replayOp(p.OperationID, fingerprint)
	if perr != nil {
		entry.mu.Unlock()
		e.invalidateV2Wave(entry, ticket)
		e.replyUploadErr(s, id, perr)
		return
	}
	if cached != nil {
		// Idempotent replay of a settled outcome; never write again. A
		// ticketed redelivery still frees its freshly claimed window slot
		// (no prefix advance) under the same serialization.
		if ticket != nil {
			entry.pipeline.settleTicket(ticket, 0)
		}
		entry.mu.Unlock()
		e.reply(s, id, cached)
		return
	}
	if ticket == nil {
		// Claim refused at admission and no recorded outcome: a new
		// operation at a live/old offset may never reach the disk path.
		entry.mu.Unlock()
		e.replyErr(s, id, "conflict", "write offset is already settled or in flight; resend with the original operation_id")
		return
	}
	// Ticket validity re-checked under serialization, immediately before
	// WriteAtV2: an invalidated (cancelled/expired/superseded) ticket can
	// never write even if its root lookup finally returned.
	if !entry.pipeline.live(ticket) {
		entry.mu.Unlock()
		e.invalidateV2Wave(entry, ticket)
		e.replyErr(s, id, "conflict", "write ticket was invalidated")
		return
	}
	if entry.stage == nil || entry.offset != *p.Offset {
		entry.mu.Unlock()
		e.invalidateV2Wave(entry, ticket)
		e.replyUploadErr(s, id, workspace.ErrConflict)
		return
	}
	werr := entry.stage.WriteAtV2(*p.Offset, data)
	if werr != nil {
		entry.recordOpError(p.OperationID, fingerprint, werr)
		// Conditional wave invalidation under entry.mu -> pipeline.mu: the
		// failing ticket passed the live() check above, so this kills the
		// current wave; a stale handler can never reach here for a newer
		// resume wave. No write for any successor; never auto-retry.
		entry.pipeline.invalidateWave(ticket)
		entry.mu.Unlock()
		e.replyUploadErr(s, id, werr)
		return
	}
	entry.offset = entry.stage.Wrote()
	result := e.uploadResult(entry)
	entry.recordOpSuccess(p.OperationID, fingerprint, result)
	// Advance the durable-prefix mirror and signal the ticket BEFORE the
	// success ACK, under the entry.mu -> pipeline.mu serialization. A
	// barrier that captured this ticket can only wake after this, and the
	// copied receipt carries this write's own end offset.
	entry.pipeline.settleTicket(ticket, entry.offset)
	entry.mu.Unlock()
	e.reply(s, id, result)
}

// invalidateV2Wave drops a ticket's admission wave on behalf of a write
// handler exit that did not complete a write (bounded wait timeout,
// ownership/root failure, malformed identity, stale entry state). It takes
// entry.mu FIRST (entry.mu -> pipeline.mu), so an in-flight predecessor
// write running under entry.mu — including its prefix settlement —
// completes before the wave is dropped; the mirror therefore can never lag
// the durable entry offset. The pipeline invalidation itself is
// conditional: a stale ticket whose wave was already invalidated is a no-op
// and a newer resume wave survives. A nil ticket (receipt-only admission)
// is a no-op.
func (e *Engine) invalidateV2Wave(entry *uploadEntry, ticket *uploadTicket) {
	if ticket == nil || entry == nil || entry.pipeline == nil {
		return
	}
	entry.mu.Lock()
	entry.pipeline.invalidateWave(ticket)
	entry.mu.Unlock()
}

// awaitV2Predecessors blocks the write goroutine (no extra goroutine) until
// every admitted ticket below this one's offset has settled, the ticket is
// invalidated, or ONE absolute wait deadline expires. Returns false when the
// ticket is no longer writable (timeout, invalidation, or predecessor
// failure wave).
//
// Out-of-order arrivals are handled by the change broadcast: a successor
// (e.g. offset 3) that parks with no admitted predecessor is rechecked via
// the gate's changed channel whenever a lower ticket is admitted or settled,
// so it wakes promptly once offsets 0/1/2 land — never sleeping out the whole
// wait-limit. Waiting is done by the write goroutine itself; no busy polling,
// no extra goroutine per wait.
func (e *Engine) awaitV2Predecessors(entry *uploadEntry, ticket *uploadTicket) bool {
	g := entry.pipeline
	// ONE absolute deadline for the entire predecessor wait (the write
	// goroutine re-snapshots on each notification but never extends the wait).
	absDeadline := time.Now().Add(uploadV2WaitLimit)
	for {
		snap := g.waitSnapshot(ticket)
		if !snap.live {
			return false
		}
		if ticket.offset <= snap.prefix {
			return true
		}
		remaining := time.Until(absDeadline)
		if remaining <= 0 {
			return false
		}
		if !waitV2Notify(snap, ticket, remaining) {
			return false
		}
	}
}

// waitV2Notify blocks until the first of: a lower predecessor ticket settles,
// the gate's change broadcast fires (an admission or settlement that may have
// advanced the prefix), the ticket's own done closes (external invalidation),
// or the caller's single remaining deadline elapses. A true result means the
// caller must re-snapshot (something that could advance it happened); false
// means the ticket is no longer writable (timeout or invalidation) and the
// wave must be failed closed without advancing a gap. No busy polling: it
// only wakes on a real pipeline event or the timeout (via the timeAfter seam
// for the no-predecessor case).
func waitV2Notify(snap v2WaitSnapshot, ticket *uploadTicket, remaining timeDuration) bool {
	if len(snap.lower) == 0 {
		// No admitted predecessor below us: either our offset is at the
		// prefix (caller handles), or the predecessors were admitted at a
		// later offset order. Wait on the change broadcast (so a subsequent
		// admission/settlement of a lower offset wakes us), our own done
		// (so Cancel wakes us) and the single remaining timeout via the
		// timeAfter seam.
		select {
		case <-ticket.done:
			return false
		case <-snap.changed:
			return true
		case <-timeAfter(remaining):
			return false
		}
	}
	return waitChansNotify(snap.lower, snap.changed, ticket.done, remaining)
}

// waitChansNotify is waitChans extended with the change-broadcast channel and
// the ticket's own done channel: it returns true on the first lower
// predecessor settling OR a pipeline change (recheck), and false on the
// ticket being invalidated or the single deadline elapsing. It allocates one
// timer for the remaining deadline.
func waitChansNotify(chans []chan struct{}, changed chan struct{}, ownDone chan struct{}, deadline timeDuration) bool {
	timer := time.NewTimer(deadline)
	defer timer.Stop()
	for _, ch := range chans {
		select {
		case <-ch:
			return true
		case <-changed:
			return true
		case <-ownDone:
			return false
		case <-timer.C:
			return false
		}
	}
	return true
}
