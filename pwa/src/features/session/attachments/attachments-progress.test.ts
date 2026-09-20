import { describe, expect, test } from "bun:test";
import {
  createAttachmentProgressMeter,
  PROGRESS_STALL_MS,
  PROGRESS_THROTTLE_MS,
  type AttachmentProgressClock,
  type AttachmentProgressSnapshot,
} from "./attachments-progress";

/** Deterministic manual clock: timers only fire when the test advances time. */
function fakeClock(start = 1000): AttachmentProgressClock & { pending: () => number; advance: (ms: number) => void } {
  let now = start;
  let seq = 1;
  type Timer = { id: number; at: number; fn: () => void };
  const timers = new Map<number, Timer>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = seq++;
      timers.set(id, { id, at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    advance(ms) {
      const deadline = now + ms;
      for (;;) {
        let next: Timer | null = null;
        for (const timer of timers.values()) {
          if (timer.at <= deadline
              && (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) {
            next = timer;
          }
        }
        if (!next) break;
        now = next.at;
        timers.delete(next.id);
        next.fn();
      }
      now = deadline;
    },
  };
}

function meter(total: number, clock: AttachmentProgressClock, signal?: AbortSignal) {
  const snapshots: AttachmentProgressSnapshot[] = [];
  const created = createAttachmentProgressMeter({
    total,
    signal,
    clock,
    emit: (snapshot) => snapshots.push(snapshot),
  });
  return { created, snapshots };
}

const EMPTY_RATE = { speedBps: undefined, etaSeconds: undefined };

describe("progress meter: baseline and resume", () => {
  test("the first acknowledged sample publishes immediately with no invented rate", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(10_000, clock);
    m.observe(4_000); // resume: these bytes already existed on the computer
    expect(snapshots).toEqual([
      { acknowledged: 4_000, waiting: false, ...EMPTY_RATE },
    ]);
    m.dispose();
  });

  test("resume counts only the post-baseline delta, never pre-existing bytes", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(10_000, clock);
    m.observe(4_000);
    clock.advance(1_000);
    m.observe(5_000); // leading edge (window passed): 1000 new B in 1s
    const latest = snapshots.at(-1)!;
    expect(latest.speedBps).toBe(1_000);
    expect(latest.etaSeconds).toBe(5); // 5000 B left at 1000 B/s
    m.dispose();
  });

  test("the first sample at zero bytes also starts without a rate", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(1_000, clock);
    m.observe(0);
    expect(snapshots.at(-1)).toEqual({ acknowledged: 0, waiting: false, ...EMPTY_RATE });
    m.dispose();
  });
});

describe("progress meter: 150ms throttle", () => {
  test("bursts coalesce to one trailing publish at 150ms carrying the newest bytes", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(100_000, clock);
    m.observe(0); // immediate leading
    clock.advance(50);
    m.observe(10_000); // inside the window: coalesced
    expect(snapshots).toHaveLength(1);
    clock.advance(PROGRESS_THROTTLE_MS - 50 - 1);
    expect(snapshots).toHaveLength(1);
    clock.advance(1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].acknowledged).toBe(10_000);
    // Throughput is measured on the sample interval (10000 B in 50ms); the
    // trailing throttle delays display but must not distort the measurement.
    expect(snapshots[1].speedBps).toBe(200_000);
    expect(snapshots[1].etaSeconds).toBeCloseTo(90_000 / 200_000, 3);
    // The trailing timer is one-shot: nothing more fires before the stall.
    clock.advance(1_000);
    expect(snapshots).toHaveLength(2);
    m.dispose();
    clock.advance(5_000);
    expect(snapshots).toHaveLength(2);
  });

  test("after the window passes a new sample publishes on the leading edge", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(1_000_000, clock);
    m.observe(0);
    clock.advance(50);
    m.observe(1_000); // trailing scheduled for t+150
    clock.advance(2_000); // trailing fired long ago
    const before = snapshots.length;
    m.observe(2_000); // 2000ms since last emit: leading again, no wait
    expect(snapshots).toHaveLength(before + 1);
    expect(snapshots.at(-1)!.acknowledged).toBe(2_000);
    m.dispose();
  });

  test("flush publishes immediately and cancels the pending trailing timer", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(100_000, clock);
    m.observe(0);
    clock.advance(40);
    m.observe(30_000); // coalesced
    expect(snapshots).toHaveLength(1);
    m.flush();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.at(-1)!.acknowledged).toBe(30_000);
    // The cancelled trailing timer must not publish the same bytes again.
    clock.advance(110);
    expect(snapshots).toHaveLength(2);
    m.dispose(); // the unrelated 3s stall timer is disposed with the attempt
    clock.advance(5_000);
    expect(snapshots).toHaveLength(2);
  });

  test("flush before any sample is a no-op", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(100, clock);
    m.flush();
    expect(snapshots).toEqual([]);
    m.dispose();
  });
});

describe("progress meter: 3s confirmation stall", () => {
  test("a 3s gap flips to waiting (hiding speed/ETA), then progress recovers", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(100_000, clock);
    m.observe(0); // t=1000, stall due 4000
    clock.advance(500);
    m.observe(20_000); // t=1500 leading; stall rescheduled to t=4500
    expect(snapshots.at(-1)!.speedBps).toBe(40_000); // 20000 B / 0.5s
    expect(snapshots.at(-1)!.waiting).toBe(false);

    clock.advance(PROGRESS_STALL_MS - 1); // t=4499: still healthy
    expect(snapshots.at(-1)!.waiting).toBe(false);
    clock.advance(1); // t=4500: stall fires
    expect(snapshots.at(-1)).toMatchObject({ acknowledged: 20_000, waiting: true });
    expect(snapshots.at(-1)!.speedBps).toBeUndefined();
    expect(snapshots.at(-1)!.etaSeconds).toBeUndefined();

    // The stall timer is one-shot; short silence never repeats the message.
    clock.advance(100);
    expect(snapshots).toHaveLength(3);

    // New acknowledged bytes clear the waiting state; within the throttle
    // window the recovery rides the trailing edge, then throughput is measured
    // over the whole attempt (40000 B / 3.6s of wall time).
    m.observe(40_000);
    expect(snapshots.at(-1)!.waiting).toBe(true); // not published yet
    clock.advance(PROGRESS_THROTTLE_MS);
    expect(snapshots.at(-1)!.waiting).toBe(false);
    expect(snapshots.at(-1)!.speedBps).toBeCloseTo(40_000 / 3.6, 3);
    expect(snapshots.at(-1)!.etaSeconds).toBeCloseTo(60_000 / (40_000 / 3.6), 3);
    m.dispose();
  });

  test("a sample inside the stall window keeps waiting hidden", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(1_000_000, clock);
    m.observe(0);
    for (let tick = 0; tick < 4; tick += 1) {
      clock.advance(1_000);
      m.observe((tick + 1) * 10_000); // progress every second
    }
    expect(snapshots.every((s) => s.waiting === false)).toBe(true);
    m.dispose();
  });
});

describe("progress meter: abort, disposal and late callbacks", () => {
  test("aborting the signal cancels both pending timers and drops later callbacks", () => {
    const clock = fakeClock();
    const abort = new AbortController();
    const { created: m, snapshots } = meter(1_000_000, clock, abort.signal);
    m.observe(0);
    clock.advance(40);
    m.observe(10_000); // schedules a trailing timer; stall timer also pending
    expect(clock.pending()).toBe(2);
    abort.abort();
    expect(clock.pending()).toBe(0);
    // Late transfer callbacks after cancellation are ignored completely.
    m.observe(500_000);
    m.flush();
    expect(snapshots).toHaveLength(1);
    clock.advance(10_000);
    expect(snapshots).toHaveLength(1);
  });

  test("a meter created with an already-aborted signal starts disposed", () => {
    const clock = fakeClock();
    const abort = new AbortController();
    abort.abort();
    const { created: m, snapshots } = meter(1_000, clock, abort.signal);
    m.observe(100);
    m.flush();
    expect(snapshots).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  test("dispose is idempotent and stops timers and late callbacks", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(1_000_000, clock);
    m.observe(0);
    clock.advance(40);
    m.observe(10_000);
    expect(clock.pending()).toBe(2);
    m.dispose();
    m.dispose();
    expect(clock.pending()).toBe(0);
    m.observe(20_000);
    m.flush();
    clock.advance(5_000);
    expect(snapshots).toHaveLength(1);
  });
});

describe("progress meter: sample hygiene", () => {
  test("acknowledged bytes clamp to total and non-monotonic samples are ignored", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(1_000, clock);
    m.observe(5_000); // over total
    expect(snapshots.at(-1)!.acknowledged).toBe(1_000);
    m.observe(900); // behind the latest offset: dropped
    expect(snapshots).toHaveLength(1);
    m.dispose();
  });

  test("NaN/Infinity samples never publish", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(1_000, clock);
    m.observe(Number.NaN); // before baseline: must not establish it
    expect(snapshots).toHaveLength(0);
    m.observe(100);
    m.observe(Number.POSITIVE_INFINITY);
    expect(snapshots.at(-1)!.acknowledged).toBe(100);
    m.dispose();
  });

  test("the final sample has speed but no ETA when zero bytes remain", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(1_000, clock);
    m.observe(0);
    clock.advance(1_000);
    m.observe(1_000);
    const latest = snapshots.at(-1)!;
    expect(latest.speedBps).toBe(1_000);
    expect(latest.etaSeconds).toBeUndefined();
    m.dispose();
  });

  test("a duplicate equal offset still flows through the throttle", () => {
    const clock = fakeClock();
    const { created: m, snapshots } = meter(1_000, clock);
    m.observe(100);
    clock.advance(200);
    m.observe(100); // no new bytes, but a fresh callback past the window
    expect(snapshots.at(-1)!.acknowledged).toBe(100);
    expect(snapshots.at(-1)!.speedBps).toBeUndefined(); // zero delta: no rate
    m.dispose();
  });
});

describe("progress meter: abort listener lifecycle", () => {
  test("a normal dispose removes its abort listener even though abort never fired", () => {
    // Track listener retention directly: a settled meter must not be kept alive
    // by the transfer's AbortSignal after an ordinary (non-abort) finish.
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      addEventListener: (type: string, fn: () => void) => {
        if (type === "abort") listeners.add(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        if (type === "abort") listeners.delete(fn);
      },
    } as unknown as AbortSignal;
    const { created: m } = meter(1_000, fakeClock(), signal);
    expect(listeners.size).toBe(1); // attached for the attempt's lifetime
    m.observe(100);
    m.dispose(); // ordinary settle: no abort event
    expect(listeners.size).toBe(0); // detached, so the signal retains no meter
    m.dispose(); // idempotent, and never re-registers
    expect(listeners.size).toBe(0);
  });
});
