package daemon

// Real injected root-latency tests for the bounded ordered V2 window.
//
// Unlike the channel-held proofs in rpc_upload_v2_pipeline_test.go, these
// subtests install a runtime wrapper on the LIVE fixture engine that delays
// every Observe by a real 50ms/100ms timer (context-aware, then the inner
// fake runtime). Begin runs first against the fast runtime; the wrapper is
// installed only afterwards, exactly as a stall test must avoid delaying
// Begin's own root resolution.
//
// What these tests claim: under per-write root Observe latency the four
// shuffled 128 KiB writes of a 512 KiB window all settle correctly, Status
// and Commit agree, and the published file is byte-for-byte the input with
// the matching SHA. They also prove the delay wrapper was actually invoked.
//
// What they deliberately do NOT claim: this source currently re-runs fresh
// per-write root authorization after predecessors, so nothing here asserts
// root-lookup coalescing, parallel fsync, or any throughput/elapsed speedup.
// The one timing assertion is a LOWER bound (the wrapper genuinely waited at
// least one delay interval), never an upper bound.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"testing"
	"time"

	"pairfob/internal/runtime"
)

// delayObserveRuntime wraps the fixture runtime: Describe/Execute pass
// through untouched, and every Observe parks for a fixed real interval on a
// context-aware timer before delegating to the inner runtime. No goroutines
// are spawned, so cleanup is just timer.Stop plus observing the in-flight
// counter drain to zero.
type delayObserveRuntime struct {
	inner runtime.Runtime
	delay time.Duration

	mu       sync.Mutex
	calls    int
	inflight int
}

func (d *delayObserveRuntime) Describe(ctx context.Context, session runtime.SessionRef) (runtime.Descriptor, error) {
	return d.inner.Describe(ctx, session)
}

func (d *delayObserveRuntime) Execute(ctx context.Context, session runtime.SessionRef, operationID string, command runtime.Command) (runtime.Receipt, error) {
	return d.inner.Execute(ctx, session, operationID, command)
}

func (d *delayObserveRuntime) Observe(ctx context.Context, session runtime.SessionRef, query runtime.Query) (runtime.View, error) {
	d.mu.Lock()
	d.calls++
	d.inflight++
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		d.inflight--
		d.mu.Unlock()
	}()

	timer := time.NewTimer(d.delay)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return d.inner.Observe(ctx, session, query)
}

func (d *delayObserveRuntime) stats() (calls, inflight int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.calls, d.inflight
}

// waitDrained fails the test if Observe calls are still in flight after the
// deadline: upload settlement must leave no hidden wrapper work behind.
func (d *delayObserveRuntime) waitDrained(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, inflight := d.stats(); inflight == 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	_, inflight := d.stats()
	t.Fatalf("delay wrapper still has %d Observe calls in flight after upload settled", inflight)
}

// runV2WindowUnderObserveDelay performs one full 512 KiB shuffled-window V2
// upload with every post-Begin Observe delayed.
func runV2WindowUnderObserveDelay(t *testing.T, delay time.Duration, uuidInt int, opTag string) {
	t.Helper()
	_, fake, engine, client := uploadFixture(t)

	const chunks = 4
	data := make([]byte, chunks*uploadChunkBytesV2) // exactly 512 KiB
	for i := range data {
		data[i] = byte(i*197 + 23)
	}
	uuid := testUUID(uuidInt)

	// Fast Begin: wrapper is installed only AFTER Begin returns, so Begin's
	// root resolution is never delayed by the test.
	beginV2(t, client, uuid, fmt.Sprintf("op_%s_begin00000001", opTag), "latency.bin", data, "application/octet-stream", "w0:p1")

	delayed := &delayObserveRuntime{inner: fake, delay: delay}
	previous := engine.RT
	engine.RT = delayed
	t.Cleanup(func() { engine.RT = previous })

	start := time.Now()

	// Four writes, shuffled arrival 2,0,3,1. RPC goroutine arrival order is
	// not execution order; every receipt must report its own end offset.
	order := []int{2, 0, 3, 1}
	type writeOutcome struct {
		chunk  int
		result map[string]any
		err    error
	}
	outcomes := make([]writeOutcome, len(order))
	var wg sync.WaitGroup
	for slot, chunk := range order {
		wg.Add(1)
		go func(slot, chunk int) {
			defer wg.Done()
			offset := chunk * uploadChunkBytesV2
			res, err := writeV2(
				t, client, uuid,
				fmt.Sprintf("op_%s_w%02d0000000001", opTag, chunk),
				offset,
				data[offset:(chunk+1)*uploadChunkBytesV2],
				"w0:p1",
			)
			outcomes[slot] = writeOutcome{chunk: chunk, result: res, err: err}
		}(slot, chunk)
	}
	wg.Wait()
	elapsedWrites := time.Since(start)

	for _, outcome := range outcomes {
		if outcome.err != nil {
			t.Fatalf("chunk %d failed under %s Observe delay: %v", outcome.chunk, delay, outcome.err)
		}
		wantEnd := float64(outcome.chunk+1) * float64(uploadChunkBytesV2)
		if outcome.result["offset"] != wantEnd {
			t.Fatalf("chunk %d receipt offset=%v, want its own end %v", outcome.chunk, outcome.result["offset"], wantEnd)
		}
		if state := outcome.result["state"]; state != "uploading" && state != "committed" {
			t.Fatalf("chunk %d state=%v", outcome.chunk, state)
		}
	}

	// The wrapper genuinely intercepted root Observes: every one of the four
	// writes performs fresh root authorization (and Status/Commit may add
	// more), so at least four delayed calls happened. This makes no claim
	// about coalescing.
	calls, _ := delayed.stats()
	if calls < chunks {
		t.Fatalf("delay wrapper Observe calls=%d, want at least %d (wrapper not actually installed?)", calls, chunks)
	}
	// Lower bound only: the writes really waited on the injected timer at
	// least once. No upper bound / throughput assertion.
	if elapsedWrites < delay {
		t.Fatalf("four delayed writes finished in %v, before even one %s delay; timer not honored", elapsedWrites, delay)
	}

	status, err := statusV2(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["offset"] != float64(len(data)) {
		t.Fatalf("status offset=%v, want %d", status["offset"], len(data))
	}

	committed, err := commitV2(t, client, uuid, fmt.Sprintf("op_%s_commit0000001", opTag), "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if committed["state"] != "committed" || committed["offset"] != float64(len(data)) {
		t.Fatalf("commit=%v", committed)
	}
	published := readPublishedV2(t, committed)
	if !bytes.Equal(published, data) {
		t.Fatalf("published %d bytes differ from input %d bytes", len(published), len(data))
	}
	sum := sha256.Sum256(published)
	if got := hex.EncodeToString(sum[:]); got != optsChecksum(data) {
		t.Fatalf("published SHA %s, want %s", got, optsChecksum(data))
	}

	// Bounded shutdown: every delayed Observe and every pipeline ticket must
	// be settled with no work left in flight, and the engine gets its fast
	// runtime back on cleanup.
	delayed.waitDrained(t)
}

func TestUploadV2WindowObserveLatency(t *testing.T) {
	cases := []struct {
		name    string
		delay   time.Duration
		uuidInt int
		opTag   string
	}{
		{name: "50ms", delay: 50 * time.Millisecond, uuidInt: 800, opTag: "v2d50"},
		{name: "100ms", delay: 100 * time.Millisecond, uuidInt: 801, opTag: "v2d100"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			runV2WindowUnderObserveDelay(t, tc.delay, tc.uuidInt, tc.opTag)
		})
	}
}
