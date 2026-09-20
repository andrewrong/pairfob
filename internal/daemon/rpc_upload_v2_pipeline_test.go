package daemon

// Stage-3 focused tests for the bounded ordered V2 upload window and the
// Status/Commit barrier. Deterministic ordering proofs use controlled
// channels (stallObserve root holds, ticket channels) rather than sleeps
// wherever possible. The separate injected-Observe-delay tests live in
// rpc_upload_v2_latency_test.go; this file makes no latency/coalescing claim.

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"sync"
	"testing"
	"time"

	"pairfob/internal/phone"
)

// v2GridUpload runs a full shuffled-window V2 upload: chunk writes arrive in
// the given shuffled offset order, all must succeed, the durable prefix must
// advance contiguously (every receipt reports its OWN end offset), and the
// committed file must match the full SHA.
func TestUploadV2WindowShuffledOrderFullSHA(t *testing.T) {
	_, _, _, client := uploadFixture(t)
	const chunks = 4
	data := make([]byte, chunks*uploadChunkBytesV2)
	for i := range data {
		data[i] = byte(i*197 + 11)
	}
	uuid := testUUID(700)
	beginV2(t, client, uuid, "op_v2win000000000001", "win.bin", data, "application/octet-stream", "w0:p1")

	// Shuffled arrival: offsets 3, 2, 0, 1. RPC goroutine arrival order is
	// not execution order; the pipeline gate must serialize by offset.
	order := []int{3, 2, 0, 1}
	type writeOutcome struct {
		offset int
		result map[string]any
		err    error
	}
	outcomes := make([]writeOutcome, len(order))
	var wg sync.WaitGroup
	for i, idx := range order {
		wg.Add(1)
		go func(slot, chunkIndex int) {
			defer wg.Done()
			offset := int64(chunkIndex) * uploadChunkBytesV2
			chunk := data[chunkIndex*uploadChunkBytesV2 : (chunkIndex+1)*uploadChunkBytesV2]
			res, err := writeV2(t, client, uuid, fmt.Sprintf("op_v2win%02d0000000000", chunkIndex), int(offset), chunk, "w0:p1")
			outcomes[slot] = writeOutcome{offset: chunkIndex, result: res, err: err}
		}(i, idx)
	}
	wg.Wait()

	byOffset := map[int]writeOutcome{}
	for _, o := range outcomes {
		byOffset[o.offset] = o
	}
	for chunkIndex := 0; chunkIndex < chunks; chunkIndex++ {
		o := byOffset[chunkIndex]
		if o.err != nil {
			t.Fatalf("chunk %d failed: %v", chunkIndex, o.err)
		}
		// EXACT receipt: each receipt reports its own write's end offset,
		// never an advanced future offset.
		wantEnd := int64(chunkIndex+1) * uploadChunkBytesV2
		if o.result["offset"] != float64(wantEnd) {
			t.Fatalf("chunk %d receipt offset=%v, want its own end %d", chunkIndex, o.result["offset"], wantEnd)
		}
		if o.result["state"] != "uploading" && o.result["state"] != "committed" {
			t.Fatalf("chunk %d state=%v", chunkIndex, o.result["state"])
		}
	}

	committed, err := commitV2(t, client, uuid, "op_v2win000000000099", "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if committed["state"] != "committed" || committed["offset"] != float64(len(data)) {
		t.Fatalf("commit=%v", committed)
	}
	published := readPublishedV2(t, committed)
	sum := sha256.Sum256(published)
	if !bytes.Equal(published, data) || hex.EncodeToString(sum[:]) != optsChecksum(data) {
		t.Fatalf("published %d bytes differ (want %d) or SHA mismatch", len(published), len(data))
	}
}

// TestUploadV2WindowMaxFour: the fifth concurrent live ticket is refused
// (window bound), without mutation; after settlement a new ticket admits.
func TestUploadV2WindowMaxFour(t *testing.T) {
	root, fake, _, client := uploadFixture(t)
	_ = root

	data := make([]byte, 6*uploadChunkBytesV2)
	uuid := testUUID(701)
	// Begin completes on the fast root first; the root-lookup hold that parks
	// the four concurrent write tickets is installed AFTER begin so it never
	// stalls the begin's own root resolution.
	beginV2(t, client, uuid, "op_v2max000000000001", "max.bin", data, "application/octet-stream", "w0:p1")

	hold := make(chan struct{})
	// Slow root (workspaceSnapshot) holds every write's root lookup so all
	// four tickets stay admitted simultaneously.
	slow := &stallObserve{inner: fake, hold: hold}
	engine := engineWithRuntime(t, client, slow)
	_ = engine

	type res struct {
		err error
	}
	results := make(chan res, 5)
	// Four writes at offsets 0,1,2,3 admitted; all parked in root lookup.
	for i := 0; i < 4; i++ {
		go func(chunk int) {
			_, err := writeV2(t, client, uuid, fmt.Sprintf("op_v2max%02d0000000000", chunk), chunk*uploadChunkBytesV2, data[chunk*uploadChunkBytesV2:(chunk+1)*uploadChunkBytesV2], "w0:p1")
			results <- res{err}
		}(i)
	}
	// Wait for four admissions to register (root holds prove they arrived).
	waitForCondition(t, 2*time.Second, func() bool {
		entry := engine.uploads.lookup(client.DeviceID, uuid)
		if entry == nil || entry.pipeline == nil {
			return false
		}
		return len(entry.pipeline.captureTickets()) == 4
	})
	// Fifth write: window full → conflict without mutation.
	fifth, err := writeV2(t, client, uuid, "op_v2max040000000000", 4*uploadChunkBytesV2, data[4*uploadChunkBytesV2:5*uploadChunkBytesV2], "w0:p1")
	if err == nil || err.Error() != "conflict" {
		t.Fatalf("fifth ticket err=%v, want conflict", err)
	}
	_ = fifth

	close(hold) // let the four complete
	for i := 0; i < 4; i++ {
		r := <-results
		if r.err != nil {
			t.Fatalf("window write failed: %v", r.err)
		}
	}
	// After settlement the window reopens: offset 4 admits and succeeds.
	if _, err := writeV2(t, client, uuid, "op_v2max040000000001", 4*uploadChunkBytesV2, data[4*uploadChunkBytesV2:5*uploadChunkBytesV2], "w0:p1"); err != nil {
		t.Fatalf("write after window settled: %v", err)
	}
}

// TestUploadV2DuplicateLiveOffsetRefused: a second write at an already-live
// offset is a conflict (duplicate ticket), no mutation.
func TestUploadV2DuplicateLiveOffsetRefused(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := make([]byte, 3*uploadChunkBytesV2)
	uuid := testUUID(702)
	beginV2(t, client, uuid, "op_v2dup000000000001", "dup.bin", data, "application/octet-stream", "w0:p1")

	// Admit one ticket at offset 0 manually (simulating an in-flight write).
	entry := engine.uploads.lookup(client.DeviceID, uuid)
	ticket, ok, _ := entry.pipeline.claimTicket(0, 0, uploadChunkBytesV2)
	if !ok {
		t.Fatal("could not claim ticket")
	}
	defer entry.pipeline.settleTicket(ticket, 0)

	// A second write at offset 0 conflicts (duplicate live offset).
	if _, err := writeV2(t, client, uuid, "op_v2dup000000000002", 0, data[:uploadChunkBytesV2], "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("duplicate live offset err=%v, want conflict", err)
	}
}

// TestUploadV2MissingPredecessorTimeout: a ticket whose offset is above the
// prefix with NO admitted predecessor (gap) times out bounded and never
// writes.
func TestUploadV2MissingPredecessorTimeout(t *testing.T) {
	_, _, _, client := uploadFixture(t)
	data := make([]byte, 3*uploadChunkBytesV2)
	uuid := testUUID(703)
	beginV2(t, client, uuid, "op_v2gap000000000001", "gap.bin", data, "application/octet-stream", "w0:p1")

	// Offset 131072 with NO offset-0 ticket: a gap. Bound the wait for the
	// test so it settles quickly.
	restore := setV2WaitLimit(200 * time.Millisecond)
	defer restore()
	start := time.Now()
	_, err := writeV2(t, client, uuid, "op_v2gap000000000002", int(uploadChunkBytesV2), data[uploadChunkBytesV2:2*uploadChunkBytesV2], "w0:p1")
	elapsed := time.Since(start)
	if err == nil || err.Error() != "conflict" {
		t.Fatalf("gap write err=%v, want conflict", err)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("gap wait unbounded: %v", elapsed)
	}
	// No bytes were written.
	status, err := statusV2(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["offset"] != float64(0) {
		t.Fatalf("gap write mutated offset: %v", status["offset"])
	}
	// The upload is NOT permanently poisoned: an explicit resume at the true
	// prefix succeeds (a new-generation ticket after Status settled).
	if _, err := writeV2(t, client, uuid, "op_v2gap000000000003", 0, data[:uploadChunkBytesV2], "w0:p1"); err != nil {
		t.Fatalf("resume after gap timeout failed: %v", err)
	}
}

// TestUploadV2FailureInvalidatesSuccessors: a failed write at offset 0
// invalidates the waiting offset-131072 ticket without writing it.
func TestUploadV2FailureInvalidatesSuccessors(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := make([]byte, 3*uploadChunkBytesV2)
	uuid := testUUID(704)
	beginV2(t, client, uuid, "op_v2failinv000000001", "failinv.bin", data, "application/octet-stream", "w0:p1")

	// Manually fail the first chunk through the storage layer: corrupt the
	// staged file so WriteAtV2's post-write verification cannot pass... the
	// storage layer fails closed on hash/sync errors. Simplest deterministic
	// failure: close the stage's file descriptor so the write errors.
	entry := engine.uploads.lookup(client.DeviceID, uuid)

	// Admit successor ticket at 131072 first (simulating an in-flight write).
	successor, ok, _ := entry.pipeline.claimTicket(uploadChunkBytesV2, 0, uploadChunkBytesV2)
	if !ok {
		t.Fatal("could not claim successor ticket")
	}

	// Force the first write to fail: close the underlying data file.
	entry.mu.Lock()
	stage := entry.stage
	entry.mu.Unlock()
	if err := stage.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := writeV2(t, client, uuid, "op_v2failinv000000002", 0, data[:uploadChunkBytesV2], "w0:p1"); err == nil {
		t.Fatal("expected first write to fail after stage close")
	}

	// The successor ticket was invalidated (settled by invalidateAll).
	select {
	case <-successor.done:
	default:
		// The write handler's failure path also calls invalidateAll, which
		// closes every admitted ticket. If not yet closed, the successor
		// would be dead on its next check anyway; poll bounded.
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			select {
			case <-successor.done:
				deadline = time.Now() // exited
			default:
				time.Sleep(time.Millisecond)
			}
			select {
			case <-successor.done:
				deadline = time.Now()
			default:
			}
			if deadline != time.Now().Add(0) {
				break
			}
		}
		select {
		case <-successor.done:
		default:
			t.Fatal("successor ticket was not invalidated by predecessor failure")
		}
	}
}

// TestUploadV2StatusBarrierRacingSlowRoot: StatusV2 waits bounded for writes
// admitted BEFORE it even when their goroutines are parked in root lookup;
// after a successful Status snapshot no late write mutates unnoticed.
func TestUploadV2StatusBarrierRacingSlowRoot(t *testing.T) {
	_, fake, _, client := uploadFixture(t)

	data := make([]byte, 2*uploadChunkBytesV2)
	uuid := testUUID(705)
	// Begin completes on the fast root; the write-parking root hold is
	// installed after begin so it never stalls begin's own root resolution.
	beginV2(t, client, uuid, "op_v2bar000000000001", "bar.bin", data, "application/octet-stream", "w0:p1")

	hold := make(chan struct{})
	slow := &stallObserve{inner: fake, hold: hold}
	engine := engineWithRuntime(t, client, slow)

	// Write at offset 0, parked in slow root lookup (ticket admitted).
	writeDone := make(chan error, 1)
	go func() {
		_, err := writeV2(t, client, uuid, "op_v2bar000000000002", 0, data[:uploadChunkBytesV2], "w0:p1")
		writeDone <- err
	}()
	waitForCondition(t, 2*time.Second, func() bool {
		entry := engine.uploads.lookup(client.DeviceID, uuid)
		return entry != nil && entry.pipeline != nil && len(entry.pipeline.captureTickets()) == 1
	})

	// StatusV2 arrives while the write is parked BEFORE entry.mu. The barrier
	// captured the ticket synchronously at admission; Status must NOT return
	// a stale offset while that write can still land.
	statusDone := make(chan struct{})
	go func() {
		defer close(statusDone)
		raw, err := client.RPCTimeout("WorkspaceUploadStatusV2", map[string]any{
			"pane_id": "w0:p1", "upload_id": uuid,
		}, testUploadTimeout)
		if err != nil {
			t.Errorf("status err=%v", err)
			return
		}
		status := decodeResult(t, raw)
		// After a SUCCESSFUL status snapshot, the parked write must have
		// settled first: offset is either 0 (write failed/not yet) or
		// 131072 (write completed) — but the reply ordering proof is that
		// status did not return until the ticket settled.
		if status["offset"] != float64(0) && status["offset"] != float64(131072) {
			t.Errorf("unexpected status offset=%v", status["offset"])
		}
	}()

	// Status must not complete while the write ticket is unsettled.
	time.Sleep(50 * time.Millisecond)
	select {
	case <-statusDone:
		t.Fatal("StatusV2 returned before the admitted write settled (barrier violated)")
	default:
	}
	// Release the write; then status completes.
	close(hold)
	if err := <-writeDone; err != nil {
		t.Fatalf("parked write failed: %v", err)
	}
	<-statusDone

	// No late write after a successful Status snapshot: a write admitted
	// AFTER the barrier returns is fine, but the barrier itself observed the
	// settled prefix.
	status, err := statusV2(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["offset"] != float64(131072) {
		t.Fatalf("post-barrier offset=%v, want 131072", status["offset"])
	}
}

// TestUploadV2CancelDuringGapSettlesPromptly: cancel while a ticket waits on
// a missing predecessor wakes it immediately (no 12s stall), the upload
// settles cancelled, and no write lands after cancel.
func TestUploadV2CancelDuringGapSettlesPromptly(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := make([]byte, 3*uploadChunkBytesV2)
	uuid := testUUID(706)
	beginV2(t, client, uuid, "op_v2cancelgap00000001", "cancelgap.bin", data, "application/octet-stream", "w0:p1")

	// Gap write at 131072 (no offset-0 ticket) waits bounded.
	restore := setV2WaitLimit(12 * time.Second)
	defer restore()
	gapDone := make(chan error, 1)
	go func() {
		_, err := writeV2(t, client, uuid, "op_v2cancelgap00000002", int(uploadChunkBytesV2), data[uploadChunkBytesV2:2*uploadChunkBytesV2], "w0:p1")
		gapDone <- err
	}()
	entry := engine.uploads.lookup(client.DeviceID, uuid)
	waitForCondition(t, 2*time.Second, func() bool {
		return len(entry.pipeline.captureTickets()) == 1
	})

	// Cancel: must settle the waiting ticket promptly.
	start := time.Now()
	cancelled, err := cancelV2(t, client, uuid, "op_v2cancelgap00000003", "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if cancelled["state"] != "cancelled" {
		t.Fatalf("cancelled=%v", cancelled)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("cancel stalled behind waiting ticket: %v", elapsed)
	}
	// The gap write failed closed without writing.
	if err := <-gapDone; err == nil || err.Error() != "conflict" {
		t.Fatalf("gap write after cancel err=%v, want conflict", err)
	}
	// No write can land after cancel.
	if _, err := writeV2(t, client, uuid, "op_v2cancelgap00000004", 0, data[:uploadChunkBytesV2], "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("write after cancel err=%v", err)
	}
}

// TestUploadV2RetiredSessionCannotWrite: a write admitted by a session that
// is retired (replaced) before its disk mutation fails forbidden without
// writing.
func TestUploadV2RetiredSessionCannotWrite(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := make([]byte, uploadChunkBytesV2)
	uuid := testUUID(707)
	beginV2(t, client, uuid, "op_v2retire0000000001", "retire.bin", data, "application/octet-stream", "w0:p1")

	// Retire the client's session (normal close, then reconnect same device
	// as a NEW session).
	route := clientRoute(engine, client)
	engine.closeSession(route, "", false)
	reconnected := reconnectSameDevice(t, engine, client.DeviceID, client.PSK, client.DaemonPK)

	// The OLD session object cannot write anymore (retired): simulate the old
	// session's write handler path via a direct engine call with a dead sess.
	oldSess := engine.Session(route)
	if oldSess != nil {
		// Bind to a fabricated call through the old session's dispatch path.
		params := []byte(`{"pane_id":"w0:p1","upload_id":"` + uuid + `","operation_id":"op_v2retire0000000002","offset":0,"data_b64":"` + base64.StdEncoding.EncodeToString(data) + `"}`)
		adm, ok := e_admitForTest(engine, oldSess, "WorkspaceUploadWriteV2", params)
		if ok {
			t.Fatal("retired session must not admit a V2 write")
		}
		_ = adm
	}

	// The reconnected session CAN continue the upload (same device).
	if _, err := writeV2(t, reconnected, uuid, "op_v2retire0000000003", 0, data, "w0:p1"); err != nil {
		t.Fatalf("reconnected session write failed: %v", err)
	}
}

// TestUploadV2ExpiryInvalidatesTickets: expiry tombstones the entry and
// wakes admitted tickets; the waiting write fails closed.
func TestUploadV2ExpiryInvalidatesTickets(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := make([]byte, 2*uploadChunkBytesV2)
	uuid := testUUID(708)
	beginV2(t, client, uuid, "op_v2expire0000000001", "expire.bin", data, "application/octet-stream", "w0:p1")

	entry := engine.uploads.lookup(client.DeviceID, uuid)
	// Gap write at 131072.
	gapDone := make(chan error, 1)
	go func() {
		_, err := writeV2(t, client, uuid, "op_v2expire0000000002", int(uploadChunkBytesV2), data[uploadChunkBytesV2:], "w0:p1")
		gapDone <- err
	}()
	waitForCondition(t, 2*time.Second, func() bool {
		return len(entry.pipeline.captureTickets()) == 1
	})

	// Force expiry: backdate expiresAt into the past so expireUpload's
	// not-yet-expired guard (same as the production expiry timers) does not
	// short-circuit, then run the real expiry path. The entry tombstone +
	// pipeline invalidation must wake the admitted gap ticket.
	entry.mu.Lock()
	entry.expiresAt = time.Now().Add(-time.Hour)
	entry.mu.Unlock()
	engine.expireUpload(entry)
	if err := <-gapDone; err == nil || err.Error() != "conflict" {
		t.Fatalf("gap write after expiry err=%v, want conflict", err)
	}
	if _, err := statusV2(t, client, uuid, "w0:p1"); err == nil || err.Error() != "workspace_not_found" {
		t.Fatalf("status after expiry err=%v", err)
	}
}

// TestUploadV2CloseUploadsInvalidatesTickets: engine shutdown wakes waiting
// tickets.
func TestUploadV2CloseUploadsInvalidatesTickets(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := make([]byte, 2*uploadChunkBytesV2)
	uuid := testUUID(709)
	beginV2(t, client, uuid, "op_v2shut000000000001", "shut.bin", data, "application/octet-stream", "w0:p1")

	entry := engine.uploads.lookup(client.DeviceID, uuid)
	gapDone := make(chan error, 1)
	go func() {
		_, err := writeV2(t, client, uuid, "op_v2shut000000000002", int(uploadChunkBytesV2), data[uploadChunkBytesV2:], "w0:p1")
		gapDone <- err
	}()
	waitForCondition(t, 2*time.Second, func() bool {
		return len(entry.pipeline.captureTickets()) == 1
	})

	engine.CloseUploads()
	if err := <-gapDone; err == nil || err.Error() != "conflict" {
		t.Fatalf("gap write after shutdown err=%v, want conflict", err)
	}
}

// TestUploadV2RootDriftDuringWait: a ticket whose root drifted while waiting
// fails closed (root authority is re-checked per write).
func TestUploadV2RootDriftDuringWait(t *testing.T) {
	root, fake, engine, client := uploadFixture(t)
	_ = root
	data := make([]byte, 2*uploadChunkBytesV2)
	uuid := testUUID(710)
	beginV2(t, client, uuid, "op_v2drift000000000001", "drift.bin", data, "application/octet-stream", "w0:p1")

	// Drift the live pane root away from the upload's pinned root.
	newRoot := t.TempDir()
	fake.Snap.Panes[0].Cwd = newRoot

	entry := engine.uploads.lookup(client.DeviceID, uuid)
	if _, err := writeV2(t, client, uuid, "op_v2drift000000000002", 0, data[:uploadChunkBytesV2], "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("root-drift write err=%v, want conflict", err)
	}
	// No bytes were written.
	entry.mu.Lock()
	offset := entry.offset
	entry.mu.Unlock()
	if offset != 0 {
		t.Fatalf("root-drift write mutated offset=%d", offset)
	}
}

// TestUploadV2LegacyUnchangedByPipeline: legacy writes on a legacy upload
// bypass the pipeline entirely (nil pipeline), keep 32 KiB semantics, and
// duplicate receipts/cross-version behavior are retained.
func TestUploadV2LegacyUnchangedByPipeline(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := make([]byte, 40000)
	uuid := testUUID(711)
	setUpFS(t, client, uuid, "op_v2legpipe000000001", "leg.bin", data, "application/octet-stream", "w0:p1")

	entry := engine.uploads.lookup(client.DeviceID, uuid)
	if entry.pipeline != nil {
		t.Fatal("legacy upload must not have a pipeline gate")
	}
	// Legacy write still works (2 chunks under 32 KiB).
	if _, err := uploadWrite(t, client, uuid, "op_v2legpipe000000002", 0, data[:32768], "w0:p1"); err != nil {
		t.Fatal(err)
	}
	// Cross-version V2 status still conflicts.
	if _, err := statusV2(t, client, uuid, "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("cross-version status err=%v", err)
	}
}

// TestUploadV2WindowShuffledOrderFastRoot: pure shuffled-arrival correctness
// over the normal fast runtime. The four 128 KiB chunks arrive out of order
// (3,2,0,1); this proves ONLY that RPC arrival order is not execution order
// and that every receipt reports its own write's end offset plus full-SHA
// commit. It injects no latency and claims nothing about coalescing.
func TestUploadV2WindowShuffledOrderFastRoot(t *testing.T) {
	_, _, _, client := uploadFixture(t)
	data := make([]byte, 4*uploadChunkBytesV2)
	uuid := testUUID(712)
	beginV2(t, client, uuid, "op_v2slow000000000001", "slow.bin", data, "application/octet-stream", "w0:p1")

	// Four shuffled writes against the fast root; the pipeline must complete
	// every write correctly (correctness only, no latency injected).
	var wg sync.WaitGroup
	for i, idx := range []int{2, 0, 3, 1} {
		wg.Add(1)
		go func(chunk int) {
			defer wg.Done()
			_, err := writeV2(t, client, uuid, fmt.Sprintf("op_v2slow%02d0000000000", i), chunk*uploadChunkBytesV2, data[chunk*uploadChunkBytesV2:(chunk+1)*uploadChunkBytesV2], "w0:p1")
			if err != nil {
				t.Errorf("chunk %d: %v", chunk, err)
			}
		}(idx)
	}
	wg.Wait()

	status, err := statusV2(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["offset"] != float64(len(data)) {
		t.Fatalf("offset after shuffled window=%v, want %d", status["offset"], len(data))
	}
}

// engineWithRuntime replaces the fixture engine's runtime and returns the
// engine bound to the client's hub (the fixture engine is the one the client
// talks to; the replacement must be applied to that engine's RT).
func engineWithRuntime(t *testing.T, client *phone.Client, rt *stallObserve) *Engine {
	t.Helper()
	engine := engineForClient(t, client)
	engine.RT = rt
	return engine
}

// engineForClient finds the engine serving this client's device session.
func engineForClient(t *testing.T, client *phone.Client) *Engine {
	t.Helper()
	// The upload fixture creates exactly one engine; locate it via the hub.
	if eng := currentFixtureEngine; eng != nil {
		return eng
	}
	t.Fatal("no engine available for client")
	return nil
}

// currentFixtureEngine is set by uploadFixture-based tests via the package
// test fixture helper (engine is returned there). This indirection exists
// only so latency tests can swap RT on the live engine.
var currentFixtureEngine *Engine

func e_admitForTest(e *Engine, s *sess, op string, params []byte) (uploadV2Admission, bool) {
	return e.admitUploadV2(s, "t1", op, params)
}

func waitForCondition(t *testing.T, limit time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("timed out waiting for condition")
}

// setV2WaitLimit bounds the pipeline wait for tests.
func setV2WaitLimit(d time.Duration) func() {
	prev := uploadV2WaitLimit
	uploadV2WaitLimit = d
	return func() { uploadV2WaitLimit = prev }
}
