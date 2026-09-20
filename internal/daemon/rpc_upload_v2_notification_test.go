package daemon

// Test-only regression for the confirmed pipeline wakeup bug (D32: UI lag
// during upload stops after stop — throughput must not stall 12s under
// worker-encoded out-of-order arrivals).
//
// Scenario: the worker encodes chunk offset 3 first, so it is admitted and
// its handler parks in the predecessor-wait BEFORE offsets 0/1/2 arrive.
// Later 0/1/2 all succeed and advance the durable prefix to 3*chunk.
// Offset 3 must then wake PROMPTLY (a settlement/admission broadcast), not
// burn the full 12s uploadV2WaitLimit.
//
// The frozen bug: waitTicketWave's len(chans)==0 branch queues on the
// ticket's OWN done channel or timeAfter, never on pipeline progress, so the
// offset-3 handler sleeps for the whole wait-limit even though its
// predecessors settled. This test proves the waiting phase deterministically
// with the existing `timeAfter` seam (the first empty-chans wait after
// begin belongs to offset 3, the only admitted ticket), then exercises
// 0/1/2, and asserts offset 3 wakes well before the wait-limit.
//
// This test does NOT fix production. Captain merges it only after the
// production leaf broadcasts admission/settlement changes.

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestUploadV2OutOfOrderOffset3WakesPromptly(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	_ = engine

	// 4 chunks: offsets 0,1,2,3. Begin with the full declared size.
	data := make([]byte, 4*uploadChunkBytesV2)
	for i := range data {
		data[i] = byte(i*211 + 3)
	}
	uuid := testUUID(708)
	beginV2(t, client, uuid, "op_v2notif0000000001", "notif.bin", data, "application/octet-stream", "w0:p1")

	// Bounded wait-limit so the test is short and the difference between a
	// prompt wake and a full-limit sleep is unmistakable.
	restoreLimit := setV2WaitLimit(2 * time.Second)
	t.Cleanup(restoreLimit)

	// Deterministic proof-of-waiting seam: waitTicketWave's empty-chans
	// branch calls timeAfter(deadline). With only offset 3 admitted and no
	// other V2 write in flight, the first timeAfter call after begin
	// unambiguously belongs to offset 3's parked predecessor-wait. The seam
	// only observes and returns the real timer; it changes no behavior.
	waitStarted := make(chan struct{}, 1)
	seamFired := false
	var seamMu sync.Mutex
	prevTF := timeAfter
	timeAfter = func(d time.Duration) <-chan time.Time {
		seamMu.Lock()
		fired := seamFired
		seamFired = true
		seamMu.Unlock()
		if !fired {
			select {
			case waitStarted <- struct{}{}:
			default:
			}
		}
		return prevTF(d)
	}
	t.Cleanup(func() { timeAfter = prevTF })

	// Admit offset 3 FIRST and run it in a goroutine.
	offset3Start := time.Now()
	type o3result struct {
		res map[string]any
		err error
	}
	o3 := make(chan o3result, 1)
	go func() {
		res, err := writeV2(t, client, uuid, "op_v2notif0000000002", 3*uploadChunkBytesV2, data[3*uploadChunkBytesV2:4*uploadChunkBytesV2], "w0:p1")
		o3 <- o3result{res, err}
	}()

	// Deterministically wait until offset 3's handler is parked in the
	// empty-chans predecessor-wait BEFORE admitting offsets 0/1/2.
	select {
	case <-waitStarted:
		// Offset 3 is admitted and waiting on its own done / timeAfter, with
		// an EMPTY predecessor wave. This is the exact buggy phase.
	case <-time.After(3 * time.Second):
		t.Fatalf("offset 3 handler never entered the predecessor wait (seam did not fire)")
	}

	// Now offsets 0/1/2 arrive (worker-encoded later) and all succeed.
	lower := make([]error, 3)
	lowerDone := make(chan int, 3)
	for ci := 0; ci < 3; ci++ {
		ci := ci
		go func() {
			_, err := writeV2(t, client, uuid, fmt.Sprintf("op_v2notif%02d0000000000", ci), ci*uploadChunkBytesV2, data[ci*uploadChunkBytesV2:(ci+1)*uploadChunkBytesV2], "w0:p1")
			lower[ci] = err
			lowerDone <- ci
		}()
	}
	for i := 0; i < 3; i++ {
		ci := <-lowerDone
		if lower[ci] != nil {
			t.Fatalf("predecessor offset %d failed: %v", ci, lower[ci])
		}
	}

	// Offset 3 must wake promptly (well under the 2s wait-limit) and
	// SUCCEED. Under the frozen bug it sleeps the full wait-limit and then
	// fails closed as a timeout conflict — the exact stale phase recorded in
	// NOTIFICATION-REPORT.md.
	select {
	case r := <-o3:
		elapsed := time.Since(offset3Start)
		if r.err != nil {
			t.Fatalf("offset 3 did not wake promptly after predecessors succeeded: err=%v after %v (frozen bug: empty-chans wait selects on own ticket.done / timeAfter, not pipeline settlement/admission broadcast)", r.err, elapsed)
		}
		if elapsed > 1500*time.Millisecond {
			t.Fatalf("offset 3 woke too slowly: %v after predecessors settled, want prompt (<1.5s)", elapsed)
		}
	case <-time.After(2800 * time.Millisecond):
		t.Fatalf("offset 3 never completed within the bounded window after predecessors succeeded")
	}

	// Cleanup: settle the upload fully (release slots / RPC handles).
	if _, err := cancelV2(t, client, uuid, "op_v2notif0000000003", "w0:p1"); err != nil {
		t.Fatalf("cleanup cancel failed: %v", err)
	}
}
