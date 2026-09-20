package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"pairfob/internal/phone"
)

func rawParams(t *testing.T, m map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func sessionFor(t *testing.T, engine *Engine, client *phone.Client) *sess {
	t.Helper()
	return engine.Session(clientRoute(engine, client))
}

// TestUploadBeginPrefocksBeforePublish proves the admission invariant that
// fixed the half-initialized-entry race: registry.begin writes the complete
// immutable metadata and pre-locks the (unpublished) entry before it becomes
// discoverable, and the caller keeps that lock through staging so no observer
// can ever see a partial entry, cancel it, and let begin resurrect it.
func TestUploadBeginPrefocksBeforePublish(t *testing.T) {
	r := newUploadRegistry()
	dev, uuid := "dev_admit", "00000000-0000-4000-8000-000000000001"
	meta := uploadBeginMeta{size: 10, paneID: "w0:p1", root: "/workspace/r", name: "f.bin", sha256: strings.Repeat("a", 64), mime: "application/octet-stream"}
	entry, created, wire := r.begin(dev, uuid, meta)
	if !created || wire != "" || entry == nil {
		t.Fatalf("begin created=%v wire=%q entry=%v", created, wire, entry)
	}
	// Immutable metadata is fully populated at publish time.
	if entry.name != "f.bin" || entry.paneID != "w0:p1" || entry.root != "/workspace/r" || entry.size != 10 || entry.state != uploadStateUploading {
		t.Fatalf("published entry incomplete: %+v", entry)
	}
	// The pre-lock is held by the caller: a concurrent locker must block.
	acquired := make(chan struct{})
	go func() { entry.mu.Lock(); close(acquired); entry.mu.Unlock() }()
	select {
	case <-acquired:
		t.Fatal("entry.mu was not held after begin returned")
	case <-time.After(50 * time.Millisecond):
	}
	// A concurrent lookup already sees the complete published entry.
	if got := r.lookup(dev, uuid); got == nil || got.name != "f.bin" {
		t.Fatalf("published entry not discoverable/complete")
	}
	entry.mu.Unlock()
	// Re-binding the same upload must NOT resurrect a fresh entry.
	again, created2, _ := r.begin(dev, uuid, meta)
	if created2 || again != entry {
		t.Fatalf("re-begin contributed a fresh entry: created=%v ptr=%p", created2, again)
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
}

// TestUploadBeginInitBarrierConcurrentStatusCancel drives Status and Cancel
// concurrently while a Begin is parked between publication and staging attach.
// It asserts: neither observes a partial/nil entry (they block until begin
// finishes), no goroutine panics, the entry ends terminal-cancelled with quota
// released exactly once, and a follow-up Begin cannot resurrect it.
func TestUploadBeginInitBarrierConcurrentStatusCancel(t *testing.T) {
	_, fake, engine, client := uploadFixture(t)
	sess := sessionFor(t, engine, client)
	data := []byte("barrier content")
	uuid := testUUID(620)
	beginParams := map[string]any{
		"pane_id": "w0:p1", "upload_id": uuid, "operation_id": "op_beginbarrier00001",
		"name": "barrier.txt", "size": len(data), "sha256": optsChecksum(data), "mime": "text/plain",
	}
	statusParams := map[string]any{"pane_id": "w0:p1", "upload_id": uuid}
	cancelParams := map[string]any{"pane_id": "w0:p1", "upload_id": uuid, "operation_id": "op_cancelbarrier0001"}

	entered := make(chan struct{})
	releaseGate := make(chan struct{})
	restore := setUploadStageGate(func(_ *uploadEntry) {
		close(entered)
		<-releaseGate
	})
	defer restore()

	beginDone := make(chan struct{})
	go func() {
		engine.rpcUploadBegin(sess, "b1", rawParams(t, beginParams), false)
		close(beginDone)
	}()

	<-entered // begin is published+prelocked, staging parked

	var wg sync.WaitGroup
	statusDone := make(chan struct{})
	cancelDone := make(chan struct{})
	wg.Add(2)
	go func() {
		defer wg.Done()
		engine.rpcUploadStatus(sess, "s1", rawParams(t, statusParams), false, nil)
		close(statusDone)
	}()
	go func() {
		defer wg.Done()
		engine.rpcUploadCancel(sess, "c1", rawParams(t, cancelParams), false)
		close(cancelDone)
	}()

	// Let them queue on entry.mu; neither may return while begin is parked.
	time.Sleep(50 * time.Millisecond)
	select {
	case <-statusDone:
		t.Fatal("Status returned before begin finished initializing (partial/nil state observed)")
	default:
	}
	select {
	case <-cancelDone:
		t.Fatal("Cancel returned before begin finished initializing (partial/nil state observed)")
	default:
	}

	close(releaseGate) // let begin complete initialization
	<-beginDone
	wg.Wait()

	// Deterministic terminal state regardless of Status/Cancel interleaving:
	// the entry is cancelled, quota is released exactly once, and no stage
	// survives (no resurrection).
	engine.uploads.mu.Lock()
	entry := engine.uploads.byKey[uploadKey(client.DeviceID, uuid)]
	pending, active := engine.uploads.pendingBytes, engine.uploads.active
	engine.uploads.mu.Unlock()
	if entry == nil {
		t.Fatal("cancelled entry should remain Status-visible")
	}
	entry.mu.Lock()
	state, stage := entry.state, entry.stage
	entry.mu.Unlock()
	if state != uploadStateCancelled || stage != nil {
		t.Fatalf("after barrier entry state=%q stage=%v", state, stage)
	}
	if pending != 0 || active != 0 {
		t.Fatalf("quota leaked after barrier: pending=%d active=%d", pending, active)
	}

	// A follow-up Begin on the same upload must not resurrect a fresh entry.
	again, created, wire := engine.uploads.begin(client.DeviceID, uuid, uploadBeginMeta{
		size: int64(len(data)), paneID: "w0:p1", root: entry.root, name: "barrier.txt",
		sha256: optsChecksum(data), mime: "text/plain",
	})
	if created || wire != "" || again == nil || again.state != uploadStateCancelled || again.stage != nil {
		t.Fatalf("re-begin resurrected or errored: created=%v wire=%q entry=state:%s stage:%v", created, wire, again.state, again.stage)
	}
	_ = fake
}

func TestUploadReceiptAndRegistryCaps(t *testing.T) {
	// Operation-receipt cap: the map never grows past the cap and new ops are
	// rejected (before any mutation) once full, without the rejected call
	// growing the map.
	entry := &uploadEntry{opSeen: map[string]uploadOpResult{}}
	for i := 0; i < uploadMaxReceiptsPerUpload; i++ {
		entry.recordOpSuccess(fmt.Sprintf("op_cap%06d", i), "fp", map[string]any{"i": i})
	}
	result, err, ok := entry.replayOp("op_newaftercap", "fpX")
	if !ok || result != nil || !errors.Is(err, errUploadReceiptsFull) {
		t.Fatalf("expected receipts-full rejection, got result=%v err=%v ok=%v", result, err, ok)
	}
	entry.opMu.Lock()
	size := len(entry.opSeen)
	entry.opMu.Unlock()
	if size != uploadMaxReceiptsPerUpload {
		t.Fatalf("rejected call grew receipt map: %d", size)
	}

	// Registry cap: after uploadRegistryMaxEntries admissions, further begins
	// are refused with backpressure and never create a new entry.
	r := newUploadRegistry()
	meta := uploadBeginMeta{size: 1, paneID: "w0:p1", root: "/r", name: "f", sha256: strings.Repeat("0", 64), mime: "text/plain"}
	var held []*uploadEntry
	for i := 0; i < uploadRegistryMaxEntries; i++ {
		ent, created, wire := r.begin(fmt.Sprintf("dev_%d", i), fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1), meta)
		if !created || wire != "" || ent == nil {
			t.Fatalf("unexpected refusal at %d: created=%v wire=%q", i, created, wire)
		}
		held = append(held, ent)
	}
	e, created, wire := r.begin("dev_full", "00000000-0000-4000-8000-000000009999", meta)
	if e != nil || created || wire != "backpressure" {
		t.Fatalf("expected backpressure at registry cap, got created=%v wire=%q", created, wire)
	}
	for _, ent := range held {
		ent.mu.Unlock()
	}
}

func TestUploadNameAndMIMEBounds(t *testing.T) {
	// UTF-16 unit bound: the server is not more permissive than the PWA
	// (<=255 UTF-16 units). 128 astral runes == 256 UTF-16 units, so rejected.
	astral := strings.Repeat("\U0001F600", 128) // each emoji is one rune but two UTF-16 units
	if validDisplayName(astral) {
		t.Fatal("astral name of 128 runes (256 UTF-16 units) must be rejected")
	}
	if !validDisplayName(strings.Repeat("a", uploadMaxNameUnits)) {
		t.Fatal("BMP name at the UTF-16 bound must be accepted")
	}
	if validDisplayName(strings.Repeat("a", uploadMaxNameUnits+1)) {
		t.Fatal("name one unit over the bound must be rejected")
	}
	if validDisplayName("name\x02") {
		t.Fatal("name with a control character must be rejected")
	}
	if validDisplayName("") {
		t.Fatal("empty name must be rejected")
	}

	for _, good := range []string{"text/plain", "application/octet-stream", "image/png", "Text/Plain"} {
		if !validMime(good) {
			t.Fatalf("valid mime %q rejected", good)
		}
	}
	for _, bad := range []string{"", "not a mime", "text/", "/plain", "text/plain extra", strings.Repeat("a", 65) + "/x", "te\nxt/plain"} {
		if validMime(bad) {
			t.Fatalf("invalid mime %q accepted", bad)
		}
	}
}

func TestUploadCloseUploadsPreservesCommittedAndStopsAdmission(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	t.Cleanup(func() { engine.CloseUploads() })

	committed := []byte("committed file body")
	commitUUID := testUUID(700)
	setUpFS(t, client, commitUUID, "op_closebegin000001", "kept.txt", committed, "text/plain", "w0:p1")
	uploadWrite(t, client, commitUUID, "op_closewrite000001", 0, committed, "w0:p1")
	commitRaw, err := client.RPCTimeout("WorkspaceUploadCommit", map[string]any{
		"pane_id": "w0:p1", "upload_id": commitUUID, "operation_id": "op_closecommit00001",
	}, testUploadTimeout)
	if err != nil {
		t.Fatal(err)
	}
	committedPath := decodeResult(t, commitRaw)["path"].(string)
	if _, err := os.Stat(committedPath); err != nil {
		t.Fatalf("committed file missing before close: %v", err)
	}

	pendingUUID := testUUID(701)
	setUpFS(t, client, pendingUUID, "op_closebegin000002", "pending.bin", []byte("pending"), "application/octet-stream", "w0:p1")

	engine.CloseUploads()

	// Committed file is preserved; its in-memory record and quota are drained.
	if _, err := os.Stat(committedPath); err != nil {
		t.Fatalf("CloseUploads deleted a committed file: %v", err)
	}
	engine.uploads.mu.Lock()
	left, pending, active := len(engine.uploads.byKey), engine.uploads.pendingBytes, engine.uploads.active
	engine.uploads.mu.Unlock()
	if left != 0 || pending != 0 || active != 0 {
		t.Fatalf("CloseUploads did not drain registry: len=%d pending=%d active=%d", left, pending, active)
	}

	// New admission is refused with backpressure after close.
	e, created, wire := engine.uploads.begin("dev_new", "00000000-0000-4000-8000-000000007777", uploadBeginMeta{
		size: 1, paneID: "w0:p1", root: "/r", name: "f", sha256: strings.Repeat("0", 64), mime: "text/plain",
	})
	if e != nil || created || wire != "backpressure" {
		t.Fatalf("admission not stopped after close: created=%v wire=%q", created, wire)
	}
	// Calling close again is idempotent.
	engine.CloseUploads()
}
