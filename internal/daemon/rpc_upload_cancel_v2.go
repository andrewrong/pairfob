// WorkspaceUploadCancel / WorkspaceUploadCancelV2. Both versions share one
// entrypoint and one body: the immutable per-upload protocol version is
// checked UNDER entry.mu BEFORE any mutation (a legacy Cancel on a V2 entry
// and a V2 Cancel on a legacy entry are both refused as a conflict, with no
// state or pipeline change). For V2 the waiting tickets are invalidated
// inside that same entry.mu critical section (entry.mu -> pipeline.mu), so
// cancellation is serialized against an in-flight disk write and queued
// writes wake and fail closed promptly without a write landing after
// cancel. Cancel does not require the live pane root to still resolve, so
// the user can always free quota even if the workspace moved or
// disappeared. Uncertain-publish reconciliation and committed-file
// preservation are inherited unchanged.
package daemon

import (
	"encoding/json"

	"pairfob/internal/workspace"
)

// uploadCancelParams are the shared cancel request fields (identical for the
// legacy and V2 ops).
type uploadCancelParams struct {
	workspacePaneParams
	UploadID    string `json:"upload_id"`
	OperationID string `json:"operation_id"`
}

// rpcUploadCancel handles both WorkspaceUploadCancel (v2=false) and
// WorkspaceUploadCancelV2 (v2=true). Params and ownership validation are
// identical for both wire ops; the version binding is enforced inside the
// locked shared body.
func (e *Engine) rpcUploadCancel(s *sess, id string, params json.RawMessage, v2 bool) {
	var p uploadCancelParams
	if badParams(params, &p) || !uploadIDPattern.MatchString(p.UploadID) || !operationName.MatchString(p.OperationID) || invalidSession(p.Session) || !validID(p.PaneID) {
		e.replyErr(s, id, "invalid_argument", "invalid upload cancel request")
		return
	}
	entry := e.uploads.lookup(s.deviceID, p.UploadID)
	if entry == nil {
		e.replyErr(s, id, "workspace_not_found", "upload handle is no longer available")
		return
	}
	// Cancel only needs the device+pane ownership binding; it does not require
	// the pane root to still resolve so the user can always free quota even if
	// the workspace moved or disappeared.
	if !e.bindPhase(s, id, p.workspacePaneParams, entry, false) {
		return
	}
	e.cancelUploadShared(s, id, p, entry, v2)
}

// cancelUploadShared is the shared cancellation body. The caller has already
// validated params and ownership. Everything happens under entry.mu:
// version rejection, receipt replay, V2 ticket invalidation, uncertain
// publish reconciliation, staging abort, settle and the terminal receipt.
func (e *Engine) cancelUploadShared(s *sess, id string, p uploadCancelParams, entry *uploadEntry, v2 bool) {
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if e.refuseIfExpired(s, id, entry) {
		return
	}
	// Version check BEFORE any mutation or receipt replay: the operation
	// must match the immutable version the upload was begun with.
	if entry.v2 != v2 {
		e.replyErr(s, id, "conflict", "upload was begun with a different upload protocol version")
		return
	}
	fingerprint, ferr := uploadFingerprint("cancel", struct {
		PaneID string `json:"pane_id"`
	}{p.PaneID})
	if ferr != nil {
		e.replyErr(s, id, "internal", "could not fingerprint upload cancel")
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
	if entry.state == uploadStateCommitted {
		e.replyErr(s, id, "conflict", "a finished upload cannot be cancelled")
		return
	}
	if entry.stage != nil && entry.stage.Committed() {
		// A rename was attempted: the upload may already be the committed
		// winner. Never abort or claim cancelled; reconcile instead.
		switch code, reResult := e.reconcileCommittedLocked(entry); code {
		case "committed":
			e.reply(s, id, reResult)
		case "unknown":
			e.replyErr(s, id, "unknown_outcome", "publish outcome is unknown; do not resend it")
		default:
			e.replyUploadErr(s, id, workspace.ErrConflict)
		}
		return
	}
	if entry.state == uploadStateCancelled {
		// Already cancelled: deliver the current terminal state without
		// recording another receipt, so final-state calls cannot grow the map.
		e.reply(s, id, e.uploadResult(entry))
		return
	}
	// Stop every queued/in-flight V2 ticket before the stage is aborted,
	// under the fixed entry.mu -> pipeline.mu order: waiting goroutines wake
	// now and fail closed, and a write that reaches the entry lock after
	// this observes a non-live ticket (and cancelled state) without writing.
	if entry.pipeline != nil {
		entry.pipeline.invalidateAll()
	}
	stage := entry.stage
	entry.stage = nil
	entry.state = uploadStateCancelled
	entry.cancelExpiryTimer()
	if stage != nil {
		_ = stage.Abort()
	}
	e.uploads.settle(entry)
	entry.armFinalExpiry(e)
	result := e.uploadResult(entry)
	entry.finalizeReceipts(p.OperationID, fingerprint, result)
	e.audit("workspace_upload_cancel", map[string]any{"device_id": s.deviceID, "operation_id": p.OperationID})
	e.reply(s, id, result)
}
