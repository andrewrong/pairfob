package daemon

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sync"
	"time"

	"pairfob/internal/workspace"
)

const (
	uploadChunkBytes = workspace.AttachChunkBytes
	// uploadChunkBytesV2 is the stage-2 V2 per-chunk byte bound (the wire
	// constant for WorkspaceUploadWriteV2). The legacy 32 KiB bound is frozen.
	uploadChunkBytesV2       = workspace.AttachChunkBytesV2
	uploadMaxActivePerDevice = workspace.AttachMaxActivePerDevice
	uploadMaxPendingDevice   = workspace.AttachMaxBatchBytes
	uploadMaxPendingDaemon   = workspace.AttachMaxPendingDaemon
	uploadPendingTTL         = 24 * time.Hour
	// uploadMaxNameUnits bounds the client-supplied display name in UTF-16 code
	// units (the same unit the PWA strict parser measures) so the server is
	// never more permissive than the client for astral-plane runes.
	uploadMaxNameUnits = 255
	// uploadMaxMIMEUnits bounds the declared MIME type: ASCII, <=128 units.
	uploadMaxMIMEUnits = 128
	// uploadMaxReceiptsPerUpload caps queued operation-id receipts per upload
	// so a hostile/glitched client cannot grow the receipt map without bound.
	uploadMaxReceiptsPerUpload = 1024
	// uploadRegistryMaxEntries caps the total in-memory upload records
	// (active + terminal). Terminal metadata is reaped 24h after finalization.
	uploadRegistryMaxEntries = 4096
	// uploadCleanupOlderAgoSeconds is the age (in seconds) after which an
	// abandoned staging dir is eligible for lazy reclamation. It equals the
	// pending lifetime so a healthy in-flight stage is never removed.
	uploadCleanupOlderAgoSeconds = int64((24 * time.Hour) / time.Second)
)

var (
	errUploadOpReuse      = errors.New("operation_id was already used for a different upload action")
	errUploadReceiptsFull = errors.New("the operation receipt budget for this upload is full")
)

var uploadRPCConcurrency = make(chan struct{}, 4)

// V2 bounded pools, separate from the legacy upload RPC pool:
//   - uploadV2WriteSlots caps in-flight V2 write goroutines daemon-wide (16)
//     so four concurrent V2 uploads cannot spawn unbounded transient
//     goroutines;
//   - uploadV2ControlSlots caps V2 Status/Commit/Cancel (4) so control ops
//     can never be starved by four waiting writes.
//
// Admission is synchronous in the dispatch path; refusal is
// backpressure/rate_limited and never blocks the session loop.
var (
	uploadV2WriteSlots   = make(chan struct{}, 16)
	uploadV2ControlSlots = make(chan struct{}, 4)
)

// uploadIDPattern matches a client-generated lowercase UUID.
var uploadIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

const (
	uploadStateUploading = "uploading"
	uploadStateCommitted = "committed"
	uploadStateCancelled = "cancelled"
)

// uploadOpResult replays a previously-successful mutation for the same
// operation_id (idempotent chunk/mutation retry) without guessing success for
// an op whose outcome was uncertain.
type uploadOpResult struct {
	fingerprint string
	result      map[string]any
	err         error
}

// uploadBeginMeta carries the immutable fields reserved before an upload is
// made discoverable. They are set during registry.begin, before publication,
// so no observer can ever see a half-initialized entry. v2 is the immutable
// upload protocol version: false (zero value) means legacy 32 KiB writes,
// true means V2 128 KiB writes. It is bound at Begin with the rest of the
// metadata and never changes for the lifetime of the upload_id.
type uploadBeginMeta struct {
	size        int64
	paneID      string
	root        string
	name        string
	sha256      string
	mime        string
	sessionName string // normalized runtime session identity ("" = default)
	v2          bool   // immutable protocol version binding
}

// uploadEntry is a single in-flight attachment upload. Its immutable binding
// (deviceID, uploadID, size, paneID, root, name, sha256, mime) is written once
// inside registry.begin before the entry is published and never modified.
//
// Locking: entry.mu guards mutable phase state (stage, offset, state, timer,
// timestamps). registry.mu (r.mu) guards the upload maps, the reservation
// accounting, and the closed flag. Lock order is entry.mu -> registry.mu: no
// code path acquires an entry lock while holding the registry lock. The one
// deliberate exception is registry.begin, which pre-locks a freshly allocated,
// NOT-YET-PUBLISHED entry before inserting it into byKey; because the entry is
// unreachable at that instant it cannot participate in a wait cycle. The
// caller then keeps that lock through disk staging so the entry is never
// observable half-initialized. V2 entries add a second leaf lock, pipeline.mu,
// with fixed order entry.mu -> pipeline.mu: write IO, prefix settlement and
// every invalidation (cancel/failure/timeout/expiry/close) take pipeline.mu
// only while holding entry.mu; the gate itself never calls back into the
// entry. u.opMu guards the operation-id receipt map; handlers take it while
// holding entry.mu, and synchronous V2 admission may also read it alone (it
// is a leaf that never acquires entry.mu).
type uploadEntry struct {
	mu          sync.Mutex
	uploadID    string
	deviceID    string
	rpcSession  *string
	paneID      string
	root        string // canonical root resolved at begin
	name        string // display-only original name
	size        int64
	sha256      string
	mime        string
	sessionName string // normalized runtime session identity ("" = default)
	serverID    string // controlled staging UUID (set once staging succeeds)
	state       string
	offset      int64
	stage       *workspace.AttachStage
	finalRel    string
	finalPath   string
	createdAt   time.Time
	expiresAt   time.Time
	timer       *time.Timer
	// v2 is the immutable upload protocol version bound at Begin (false =
	// legacy 32 KiB chunks, true = V2 128 KiB chunks). Stage-3: V2 writes go
	// through the per-entry bounded ordered pipeline gate. NEVER infer
	// version from chunk size: the version is stored explicitly before the
	// entry is published and any cross-version call fails closed with a
	// conflict.
	v2 bool
	// pipeline is the per-entry V2 ordered-write gate (nil for legacy). It is
	// created under the begin pre-lock, before publication, so admission in
	// the dispatch path can never observe a half-initialized gate. Lock order
	// is entry.mu -> pipeline.mu; pipeline.mu is a leaf and is never held
	// across disk or root IO by anything except the write's own entry.mu
	// critical section.
	pipeline *uploadPipeline

	// accounted is guarded by registry.mu: true while this entry's reserved
	// size still counts toward pendingBytes/active quota. Flipped false exactly
	// once when the entry settles (commit/cancel/shutdown) or is released.
	accounted bool

	// expired is a private tombstone guarded by entry.mu, set by expiry/shutdown
	// before the stage is disposed and the registry entry removed. Any handler
	// that already looked the entry up must observe it after locking and refuse
	// to operate (workspace_not_found). It is never surfaced as a wire state.
	expired bool

	// publishOpID / publishOpFp record the operation that produced a
	// committed-but-unknown publish (Commit returned ErrMutationUnknown), so a
	// later reconciliation can compact the receipt map to that single
	// non-reexecuting terminal identity. Empty means no daemon mutation
	// identity produced the published state (read-only Status reconciliation).
	publishOpID string
	publishOpFp string

	opMu   sync.Mutex
	opSeen map[string]uploadOpResult
}

type uploadRegistry struct {
	mu           sync.Mutex
	byKey        map[string]*uploadEntry
	byDevice     map[string]map[string]struct{}
	pendingBytes int64
	active       int
	// closed stops new admission (Engine.CloseUploads). Existing entries keep
	// working (serialized by entry.mu) until shutdown settles them.
	closed bool
}

func newUploadRegistry() *uploadRegistry {
	return &uploadRegistry{
		byKey:    map[string]*uploadEntry{},
		byDevice: map[string]map[string]struct{}{},
	}
}

func uploadKey(deviceID, uploadID string) string { return deviceID + "\x00" + uploadID }

// uploadFingerprint binds a phase + canonical params so reusing an
// operation_id for a different action is a conflict, never a silent no-op.
func uploadFingerprint(phase string, param any) (string, error) {
	body, err := json.Marshal(param)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(append([]byte(phase+"\x00"), body...))
	return hex.EncodeToString(sum[:]), nil
}

func newUploadServerID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	h := hex.EncodeToString(raw[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32], nil
}

// uploadLookup returns the entry owned by this authenticated device, if any.
// Uses only the immutable device binding so a session reconnect by the same
// device can inspect/continue. Returns nil when missing.
func (r *uploadRegistry) lookup(deviceID, uploadID string) *uploadEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.byKey[uploadKey(deviceID, uploadID)]
}

// begin reserves quota, writes the full immutable metadata, and pre-locks the
// entry BEFORE it is published. On success (created=true) the caller owns
// entry.mu and must finish initialization (disk staging, timer) and unlock it;
// the returned entry is already fully identical in its immutable fields to any
// later observer. On created=false the caller must Lock() the existing entry
// itself. Returns (entry, created, errWire, ok); errWire is a non-empty wire
// code on quota/concurrency/closed refusal.
func (r *uploadRegistry) begin(deviceID, uploadID string, meta uploadBeginMeta) (*uploadEntry, bool, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil, false, "backpressure"
	}
	key := uploadKey(deviceID, uploadID)
	if existing := r.byKey[key]; existing != nil {
		return existing, false, ""
	}
	if len(r.byKey) >= uploadRegistryMaxEntries {
		return nil, false, "backpressure"
	}
	owned := r.byDevice[deviceID]
	if len(owned) >= uploadMaxActivePerDevice {
		return nil, false, "rate_limited"
	}
	if r.pendingBytes+meta.size > uploadMaxPendingDaemon {
		return nil, false, "backpressure"
	}
	var perDevice int64
	for id := range owned {
		if e := r.byKey[uploadKey(deviceID, id)]; e != nil {
			perDevice += e.size
		}
	}
	if perDevice+meta.size > uploadMaxPendingDevice {
		return nil, false, "rate_limited"
	}
	entry := &uploadEntry{
		uploadID: uploadID, deviceID: deviceID,
		paneID: meta.paneID, root: meta.root, size: meta.size,
		name: meta.name, sha256: meta.sha256, mime: meta.mime, sessionName: meta.sessionName,
		v2:    meta.v2,
		state: uploadStateUploading, accounted: true,
		opSeen: map[string]uploadOpResult{},
	}
	if meta.v2 {
		entry.pipeline = newUploadPipeline()
	}
	// Pre-lock an unpublished, unreachable entry. This cannot deadlock: no
	// other goroutine can hold it yet. The caller keeps the lock through
	// staging so concurrent Status/Cancel/Write block until initialization is
	// complete instead of observing a partial entry.
	entry.mu.Lock()
	r.byKey[key] = entry
	if owned == nil {
		owned = map[string]struct{}{}
		r.byDevice[deviceID] = owned
	}
	owned[uploadID] = struct{}{}
	r.pendingBytes += meta.size
	r.active++
	return entry, true, ""
}

// release fully drops a pending entry from the registry, releasing any
// reserved quota and active slot for the first and only time. Call only after
// the entry has no live stage and no further RPC should observe it.
func (r *uploadRegistry) release(e *uploadEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := uploadKey(e.deviceID, e.uploadID)
	if r.byKey[key] != e {
		return
	}
	delete(r.byKey, key)
	if owned := r.byDevice[e.deviceID]; owned != nil {
		delete(owned, e.uploadID)
		if len(owned) == 0 {
			delete(r.byDevice, e.deviceID)
		}
	}
	if e.accounted {
		r.pendingBytes -= e.size
		r.active--
		e.accounted = false
	}
}

// settle releases the reserved quota and active slot for an entry that has
// reached a terminal state (committed or cancelled) exactly once, while
// keeping the entry in byKey so a later Status or operation replay can still
// report the final state. Idempotent and independent of mutation order.
func (r *uploadRegistry) settle(e *uploadEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !e.accounted || r.byKey[uploadKey(e.deviceID, e.uploadID)] != e {
		return
	}
	r.pendingBytes -= e.size
	r.active--
	e.accounted = false
	if owned := r.byDevice[e.deviceID]; owned != nil {
		delete(owned, e.uploadID)
		if len(owned) == 0 {
			delete(r.byDevice, e.deviceID)
		}
	}
}

// close stops new upload admission. Existing entries remain usable (their
// operations serialize on entry.mu) until settleUploads runs.
func (r *uploadRegistry) close() {
	r.mu.Lock()
	r.closed = true
	r.mu.Unlock()
}

// CloseUploads shuts down the upload subsystem: it stops new admission, then
// settles every registered upload — waiting for any in-flight operation on an
// entry to finish (entry.mu serializes) and releasing pending FDs/timers. It
// never deletes already-committed files. Ordinary disconnects/transport resets
// do not call this; it is for engine shutdown only.
func (e *Engine) CloseUploads() {
	e.uploads.close()
	entries := e.uploads.snapshot()
	for _, ent := range entries {
		e.settleUploadForShutdown(ent)
	}
}

func (r *uploadRegistry) snapshot() []*uploadEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*uploadEntry, 0, len(r.byKey))
	for _, ent := range r.byKey {
		out = append(out, ent)
	}
	return out
}

// cleanupExpiredStaging lazily reclaims abandoned staging dirs for a root
// from inside an authorized Begin, before the new entry is reserved or
// published. It snapshots the existing entries under registry.mu (never
// holding registry.mu while also taking entry.mu), collects the controlled
// server UUIDs of stages still actively in use, and hands them to W's
// AttachCleanupExpired as activeIDs so no live stage is removed. Fresh
// concurrent stages are under 24h old, so the age bound protects them even if
// a snapshot misses them. W's implementation only ever unlinks a validated
// owned marker and its controlled data name (non-recursive) and leaves the
// final completed tree alone; cleanup failure is best-effort for admission
// and is never treated as a delete. No per-root map is built.
func (e *Engine) cleanupExpiredStaging(canonRoot string) {
	entries := e.uploads.snapshot()
	active := make([]string, 0, len(entries))
	for _, ent := range entries {
		ent.mu.Lock()
		if ent.root == canonRoot && ent.state == uploadStateUploading && ent.stage != nil && ent.serverID != "" {
			active = append(active, ent.serverID)
		}
		ent.mu.Unlock()
	}
	_, _ = workspace.AttachCleanupExpired(canonRoot, uploadCleanupOlderAgoSeconds, active)
}

// disposeStageForTerminal releases a stage at expiry/shutdown. Abort removes
// staging only if the rename never published; a published/unknown-published
// (Committed()) stage is never aborted, so completed bytes and a foreign
// replacement are preserved. The retained data descriptor is always closed
// afterwards (Abort closes it too; Close is idempotent), so a pending upload
// with a Committed()==true stage does not leak its FD. Safe to call with the
// caller's entry.mu held (only the stage's own lock is taken).
func disposeStageForTerminal(stage *workspace.AttachStage) {
	if stage == nil {
		return
	}
	if !stage.Committed() {
		_ = stage.Abort()
	}
	_ = stage.Close()
}

// settleUploadForShutdown tombstones each entry and disposes its stage. It
// holds entry.mu through pipeline invalidation (entry.mu -> pipeline.mu
// order, so a write currently running under entry.mu settles first),
// disposal and registry removal (entry->registry order; no registry lock is
// held across filesystem I/O). Handlers that looked the entry up before
// shutdown observe the tombstone and refuse to operate. Committed/
// unknown-published files are preserved.
func (e *Engine) settleUploadForShutdown(ent *uploadEntry) {
	ent.mu.Lock()
	// Wake and drop any admitted V2 tickets under the entry lock: waiting
	// write goroutines fail closed instead of blocking on a dead upload, and
	// the invalidation is serialized against an in-flight disk write.
	if ent.pipeline != nil {
		ent.pipeline.invalidateAll()
	}
	ent.cancelExpiryTimer()
	ent.expired = true
	stage := ent.stage
	ent.stage = nil
	disposeStageForTerminal(stage)
	e.uploads.release(ent)
	ent.mu.Unlock()
}

// cancelExpiryTimer stops any pending/final-expiry timer. The caller must hold
// u.mu.
func (u *uploadEntry) cancelExpiryTimer() {
	if u.timer != nil {
		u.timer.Stop()
		u.timer = nil
	}
}

// armExpiry schedules the pending-upload expiry (24h from begin). The caller
// must hold u.mu. The callback reads state under the same lock and touches the
// registry only after releasing entry.mu, so it never inverts lock order.
func (u *uploadEntry) armExpiry(e *Engine) {
	if u.timer != nil {
		u.timer.Stop()
	}
	u.timer = time.AfterFunc(time.Until(u.expiresAt), func() { e.expireUpload(u) })
}

// armFinalExpiry re-arms the metadata-expiry timer for a terminal entry,
// dropping its in-memory record 24h after finalization. It never deletes the
// committed file. The caller must hold u.mu.
func (u *uploadEntry) armFinalExpiry(e *Engine) {
	u.expiresAt = time.Now().Add(uploadPendingTTL)
	if u.timer != nil {
		u.timer.Stop()
	}
	u.timer = time.AfterFunc(time.Until(u.expiresAt), func() { e.expireUpload(u) })
}

// expireUpload is the expiry callback for both pending and terminal entries.
// It holds entry.mu through deciding expiry, disposing the stage and removing
// the registry entry. It rechecks expiresAt under the lock so an old timer
// that waited on entry.mu cannot delete a freshly-finalized record whose
// expiry was moved later by armFinalExpiry. Pending (never-published) stages
// are aborted; committed/unknown-published stages only drop metadata and close
// their descriptor — the published file is never deleted here.
func (e *Engine) expireUpload(u *uploadEntry) {
	u.mu.Lock()
	if time.Now().Before(u.expiresAt) {
		u.mu.Unlock()
		return
	}
	u.cancelExpiryTimer()
	u.expired = true
	// Wake and drop admitted V2 tickets under the same entry lock
	// (entry.mu -> pipeline.mu): the gate never takes entry.mu, and a write
	// that reaches its entry.mu critical section after this observes the
	// tombstone and/or a non-live ticket and fails without writing.
	if u.pipeline != nil {
		u.pipeline.invalidateAll()
	}
	stage := u.stage
	u.stage = nil
	disposeStageForTerminal(stage)
	// Hold entry.mu while removing the registry entry (entry->registry
	// order); no registry lock is held across the filesystem disposal above.
	e.uploads.release(u)
	u.mu.Unlock()
}

// dispatchUpload routes an upload RPC onto a bounded work pool and bounds the
// global concurrent upload disk I/O so queued work never blocks the session
// input queue or runs unbounded filesystem mutations.
func (e *Engine) dispatchUpload(s *sess, id, op string, params json.RawMessage) {
	select {
	case uploadRPCConcurrency <- struct{}{}:
	default:
		e.replyErr(s, id, "rate_limited", "too many upload operations are already running")
		return
	}
	defer func() { <-uploadRPCConcurrency }()
	e.processUploadRPC(s, id, op, params)
}

// dispatchUploadAdmitted runs a V2 upload RPC whose synchronous admission
// already happened (pool slot + ticket/barrier captured). The bounded legacy
// upload disk-I/O pool is still acquired (with the V2 slot already held, so
// global upload concurrency is bounded twice over); refusal is rate_limited.
func (e *Engine) dispatchUploadAdmitted(s *sess, id, op string, params json.RawMessage, adm uploadV2Admission) {
	select {
	case uploadRPCConcurrency <- struct{}{}:
	default:
		// The admission ticket/barrier must settle exactly once even on pool
		// refusal: settle without advancing the prefix (no write happened).
		if adm.ticket != nil {
			adm.entry.pipeline.settleTicket(adm.ticket, 0)
		}
		e.replyErr(s, id, "rate_limited", "too many upload operations are already running")
		return
	}
	defer func() { <-uploadRPCConcurrency }()
	e.processUploadRPCAdmitted(s, id, op, params, adm)
}

// admitUploadV2 performs the SYNCHRONOUS dispatch-path admission for a V2
// upload RPC, before any goroutine is spawned. It NEVER acquires entry.mu:
//   - identity uses only the entry's immutable bindings (authenticated
//     device, normalized runtime session name, pane id) which are written
//     once before the entry is published;
//   - write window bounds use only the pipeline gate's durable-prefix
//     mirror, never goroutine arrival order and never the mutable
//     entry.offset/state (those are re-checked under entry.mu in the
//     handler);
//   - for writes it claims a pipeline ticket (so a later StatusV2 can
//     capture every previously admitted write even if its goroutine/root
//     lookup has not started) and synchronously rejects a retired session,
//     so a stale session can never hold a window slot;
//   - for control ops it captures the current ticket completion channels
//     (the Status/Commit barrier);
//   - it acquires the bounded V2 global pool slot so unbounded transient
//     goroutines are impossible; refusal is backpressure/rate_limited and
//     never blocks the session loop.
//
// A write whose grid claim is refused (duplicate live offset, window full,
// or an offset at/below the durable mirror) is still admitted WITHOUT a
// ticket when its operation_id already has a recorded outcome on this entry:
// that is the bounded, identity-bound same-operation redelivery path, and the
// strict handler replays the cached receipt (or redelivers the cached error)
// without any mutation. A NEW operation at an old/live offset is refused here
// as a conflict. Full strict validation (base64 decode, live pane/root,
// fingerprints) stays in the handler.
//
// Returns (admission, ok). On ok=false the refusal reply was already sent.
// release (in the admission) must be called exactly once on every later exit
// (it returns the pool slot); the handler settles any ticket.
type uploadV2Admission struct {
	entry   *uploadEntry
	ticket  *uploadTicket // nil for receipt-only same-operation admission
	chans   []chan struct{}
	release func()
}

func (e *Engine) admitUploadV2(s *sess, id, op string, params json.RawMessage) (uploadV2Admission, bool) {
	// Bounded pool acquisition is synchronous: a full pool refuses with
	// backpressure instead of queueing an unbounded goroutine.
	pool := uploadV2ControlSlots
	if op == "WorkspaceUploadWriteV2" {
		pool = uploadV2WriteSlots
	}
	select {
	case pool <- struct{}{}:
	default:
		e.replyErr(s, id, "backpressure", "too many V2 upload operations are already running")
		return uploadV2Admission{}, false
	}
	released := false
	release := func() {
		if released {
			return
		}
		released = true
		<-pool
	}
	adm := uploadV2Admission{release: release}

	// Bounded identity/offset parse for admission (full strict validation
	// remains in the handler). Malformed frames never claim a ticket. The
	// parse struct must accept every field the request schemas allow so
	// admission never rejects a request the handler would accept.
	var p struct {
		Session     *string `json:"session"`
		PaneID      string  `json:"pane_id"`
		UploadID    string  `json:"upload_id"`
		OperationID string  `json:"operation_id"`
		Offset      *int64  `json:"offset"`
		Name        string  `json:"name"`
		Size        *int64  `json:"size"`
		SHA256      string  `json:"sha256"`
		Mime        string  `json:"mime"`
		DataB64     string  `json:"data_b64"`
	}
	if badParams(params, &p) || !uploadIDPattern.MatchString(p.UploadID) || invalidSession(p.Session) || !validID(p.PaneID) {
		release()
		e.replyErr(s, id, "invalid_argument", "invalid upload request")
		return uploadV2Admission{}, false
	}
	entry := e.uploads.lookup(s.deviceID, p.UploadID)
	if entry == nil {
		release()
		e.replyErr(s, id, "workspace_not_found", "upload handle is no longer available")
		return uploadV2Admission{}, false
	}
	// Immutable bindings only (set once before publication; safe without
	// entry.mu). Mutable phase (state/expiry/offset) is the handler's
	// entry.mu responsibility.
	if entry.deviceID != s.deviceID {
		release()
		e.replyErr(s, id, "forbidden", "upload is bound to the authenticated device")
		return uploadV2Admission{}, false
	}
	if entry.sessionName != runtimeSession(p.Session).Name {
		release()
		e.replyErr(s, id, "forbidden", "upload is bound to a different runtime session; re-upload in that session")
		return uploadV2Admission{}, false
	}
	if entry.paneID != p.PaneID {
		release()
		e.replyErr(s, id, "forbidden", "upload is bound to a different pane; re-upload under the same pane")
		return uploadV2Admission{}, false
	}
	// Immutable version binding: a legacy entry (nil pipeline) or a
	// cross-version call is refused at admission without mutation. (BeginV2
	// has no entry yet and no admission path beyond the pool.)
	if entry.pipeline == nil {
		release()
		e.replyErr(s, id, "conflict", "upload was begun with a different upload protocol version")
		return uploadV2Admission{}, false
	}
	adm.entry = entry

	switch op {
	case "WorkspaceUploadWriteV2":
		if p.Offset == nil || *p.Offset < 0 {
			release()
			e.replyErr(s, id, "invalid_argument", "invalid upload write request")
			return uploadV2Admission{}, false
		}
		// Mutable session liveness is checked synchronously as well: a retired
		// session must never claim a ticket/window slot. The handler re-checks
		// liveness under entry.mu immediately before the disk mutation.
		if !s.liveDevice(e) {
			release()
			e.replyErr(s, id, "forbidden", "session is no longer established")
			return uploadV2Admission{}, false
		}
		// Admission bounds use ONLY the gate's durable mirror (no entry.mu).
		// On success the handler advances that mirror under entry.mu before
		// the success ACK, so it is always equal to the entry's durable offset.
		prefix := entry.pipeline.prefixSnapshot()
		ticket, ok, reason := entry.pipeline.claimTicket(*p.Offset, prefix, uploadChunkBytesV2)
		if ok {
			adm.ticket = ticket
			return adm, true
		}
		// Claim refused: admit ticketless only for a recorded same-operation
		// redelivery (bounded receipt replay in the strict handler); every
		// other old/live/window offset is a conflict from a new operation.
		if entry.hasOperationRecord(p.OperationID) {
			return adm, true
		}
		release()
		if reason == "duplicate" {
			e.replyErr(s, id, "conflict", "a write at this offset is already in flight")
		} else {
			e.replyErr(s, id, "conflict", "write offset is outside the admitted window")
		}
		return uploadV2Admission{}, false
	case "WorkspaceUploadStatusV2", "WorkspaceUploadCommitV2":
		// Synchronous barrier capture: every ticket already admitted to this
		// entry settles before the status/commit result is produced.
		adm.chans = entry.pipeline.captureTickets()
		return adm, true
	default: // CancelV2 (and any future control op)
		return adm, true
	}
}

func (e *Engine) uploadResult(entry *uploadEntry) map[string]any {
	// chunk_bytes is the immutable per-chunk wire bound of THIS upload's
	// protocol version, reported in every receipt so a client can never
	// misread the sequential offset plan of the upload it is driving.
	chunkBytes := uploadChunkBytes
	if entry.v2 {
		chunkBytes = uploadChunkBytesV2
	}
	result := map[string]any{
		"upload_id": entry.uploadID, "state": entry.state,
		"offset": entry.offset, "size": entry.size, "sha256": entry.sha256,
		"chunk_bytes": chunkBytes,
	}
	if entry.state == uploadStateCommitted {
		result["path"] = entry.finalPath
		result["relative_path"] = entry.finalRel
		result["name"] = entry.name
		result["mime"] = entry.mime
	}
	return result
}

// replayOp returns the cached outcome for a previously-seen operation_id.
//
//	(result, nil, true)   prior attempt succeeded; replay result, no mutation
//	(nil, err, true)      prior attempt failed/uncertain (redeliver err), or
//	                       reuse of the id for a different fingerprint, or the
//	                       receipt budget is full — never re-execute
//	(nil, nil, false)     unseen operation; caller may (capacity permitting) run
//	                       the mutation and record the outcome
func (u *uploadEntry) replayOp(operationID, fingerprint string) (result map[string]any, err error, ok bool) {
	u.opMu.Lock()
	defer u.opMu.Unlock()
	prev, exists := u.opSeen[operationID]
	if !exists {
		if len(u.opSeen) >= uploadMaxReceiptsPerUpload {
			return nil, errUploadReceiptsFull, true
		}
		return nil, nil, false
	}
	if prev.fingerprint != fingerprint {
		return nil, fmt.Errorf("%w", errUploadOpReuse), true
	}
	if prev.err != nil {
		return nil, prev.err, true
	}
	out := make(map[string]any, len(prev.result))
	for k, v := range prev.result {
		out[k] = v
	}
	return out, nil, true
}

// hasOperationRecord reports whether operationID already has a recorded
// outcome on this entry. It is the synchronous admission-time probe used by
// admitUploadV2 to distinguish a same-operation redelivery of a settled
// write (which may be replayed ticketless by the strict handler) from a new
// operation at an old/live offset (which must conflict at admission). It
// takes only the leaf opMu (never entry.mu); the receipt map is bounded by
// uploadMaxReceiptsPerUpload and the lookup is O(1).
func (u *uploadEntry) hasOperationRecord(operationID string) bool {
	u.opMu.Lock()
	_, ok := u.opSeen[operationID]
	u.opMu.Unlock()
	return ok
}

func (u *uploadEntry) recordOpSuccess(operationID, fingerprint string, result map[string]any) {
	u.opMu.Lock()
	u.opSeen[operationID] = uploadOpResult{fingerprint: fingerprint, result: result}
	u.opMu.Unlock()
}

func (u *uploadEntry) recordOpError(operationID, fingerprint string, err error) {
	u.opMu.Lock()
	u.opSeen[operationID] = uploadOpResult{fingerprint: fingerprint, err: err}
	u.opMu.Unlock()
}

// finalizeReceipts is called on a successful terminal transition (commit or
// cancel): it discards all chunk receipts and keeps only the terminal outcome
// identity so a repeated final call is replayed but can never amplify the
// receipt map on a finalized entry.
func (u *uploadEntry) finalizeReceipts(operationID, fingerprint string, result map[string]any) {
	u.opMu.Lock()
	u.opSeen = map[string]uploadOpResult{
		operationID: {fingerprint: fingerprint, result: result},
	}
	u.opMu.Unlock()
}

// preserveTerminalReceipt resets the receipt map to a single recorded outcome
// for one terminal operation, discarding chunk receipts while keeping that op
// non-reexecuting. It is used by successful reconciliation: the original
// uncertain Commit stays non-reexecuting and no fresh terminal calls grow the
// map. A nil operationID (read-only Status reconciliation with no daemon
// mutation identity) clears the map; an operation ID is never manufactured.
func (u *uploadEntry) preserveTerminalReceipt(operationID, fingerprint string) {
	u.opMu.Lock()
	if operationID == "" {
		u.opSeen = map[string]uploadOpResult{}
	} else {
		u.opSeen = map[string]uploadOpResult{
			operationID: {fingerprint: fingerprint, err: workspace.ErrMutationUnknown},
		}
	}
	u.opMu.Unlock()
}
