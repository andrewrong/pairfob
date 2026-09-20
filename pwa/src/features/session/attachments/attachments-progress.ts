/**
 * Upload progress meter for one transfer attempt.
 *
 * Duty: turn acknowledged-byte callbacks into at most ~7 visible updates per
 * second with a measured speed and approximate ETA, while keeping every timer
 * abort/dispose-safe.
 *
 * Rules (P5):
 * - leading edge: the FIRST acknowledged sample publishes immediately and
 *   establishes the measurement baseline; on resume those bytes were already
 *   on the computer and must never count as new throughput;
 * - intermediate updates are trailing-throttled to 150ms; flush() (terminal)
 *   always publishes immediately;
 * - speed is delta bytes over monotonic elapsed time since the baseline —
 *   finite and positive only, never invented;
 * - no fresh acknowledgement for 3s flips the snapshot to `waiting` and hides
 *   speed/ETA; the transfer is still alive, never failed/disconnected;
 * - an abort signal and dispose() cancel every pending timer; late callbacks
 *   after disposal are dropped.
 *
 * The clock/timer pair is injectable so tests run on a deterministic fake
 * clock; production defaults to performance.now/setTimeout.
 */
import { measureUploadRate, type AttachmentRate } from "./attach-model";

export const PROGRESS_THROTTLE_MS = 150;
export const PROGRESS_STALL_MS = 3000;

export type AttachmentProgressSnapshot = {
  acknowledged: number;
  waiting: boolean;
  speedBps?: number;
  etaSeconds?: number;
};

export type AttachmentProgressClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
};

export type AttachmentProgressMeter = {
  /** Feed one acknowledged-byte callback from the transfer layer. */
  observe(acknowledged: number): void;
  /** Publish the newest observation now, bypassing the throttle (terminal). */
  flush(): void;
  /** Cancel every timer. Safe to call more than once. */
  dispose(): void;
};

const defaultClock: AttachmentProgressClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export type CreateMeterOptions = {
  total: number;
  emit: (snapshot: AttachmentProgressSnapshot) => void;
  signal?: AbortSignal;
  clock?: AttachmentProgressClock;
};

export function createAttachmentProgressMeter(options: CreateMeterOptions): AttachmentProgressMeter {
  const clock = options.clock ?? defaultClock;
  const total = Number.isFinite(options.total) && options.total > 0 ? options.total : 0;

  let disposed = false;
  let baseAck = 0;
  let baseTime = 0;
  let lastAck = 0;
  let lastProgressTime = 0;
  let lastEmitTime = 0;
  let established = false;
  let waiting = false;
  let trailingHandle: number | null = null;
  let stallHandle: number | null = null;

  function clearTrailing(): void {
    if (trailingHandle !== null) {
      clock.clearTimeout(trailingHandle);
      trailingHandle = null;
    }
  }

  function clearStall(): void {
    if (stallHandle !== null) {
      clock.clearTimeout(stallHandle);
      stallHandle = null;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearTrailing();
    clearStall();
    // Normal settle disposes long before abort fires; detach the listener so
    // the settled meter and its emit closure are not retained by the signal.
    if (options.signal) options.signal.removeEventListener("abort", dispose);
  }

  if (options.signal) {
    if (options.signal.aborted) {
      dispose();
    } else {
      options.signal.addEventListener("abort", dispose, { once: true });
    }
  }

  function publish(now: number): void {
    lastEmitTime = now;
    let rate: AttachmentRate | null = null;
    if (!waiting && established) {
      rate = measureUploadRate(
        lastAck - baseAck,
        lastProgressTime - baseTime,
        total - lastAck,
      );
    }
    options.emit({
      acknowledged: lastAck,
      waiting,
      speedBps: rate?.speedBps,
      etaSeconds: rate?.etaSeconds,
    });
  }

  function scheduleStall(): void {
    clearStall();
    const observedAt = lastProgressTime;
    stallHandle = clock.setTimeout(() => {
      stallHandle = null;
      if (disposed) return;
      // A newer sample may have rescheduled this check; verify against it.
      if (waiting || clock.now() - observedAt < PROGRESS_STALL_MS) return;
      waiting = true;
      clearTrailing(); // the stall note is the prompt update, not stale bytes
      publish(clock.now());
    }, PROGRESS_STALL_MS);
  }

  function observe(rawAck: number): void {
    if (disposed || !Number.isFinite(rawAck)) return;
    const ack = Math.max(0, total > 0 ? Math.min(rawAck, total) : rawAck);
    const now = clock.now();
    if (!established) {
      // First sample: baseline only. No invented speed, no ETA; published
      // immediately so preparing -> uploading and bytes show right away.
      established = true;
      baseAck = ack;
      baseTime = now;
      lastAck = ack;
      lastProgressTime = now;
      scheduleStall();
      publish(now);
      return;
    }
    if (ack < lastAck) return; // offsets are monotonic; ignore late/garbled calls
    const progressed = ack > lastAck;
    lastAck = ack;
    if (progressed) {
      lastProgressTime = now;
      if (waiting) waiting = false;
      scheduleStall();
    }
    if (now - lastEmitTime >= PROGRESS_THROTTLE_MS) {
      publish(now);
      return;
    }
    // Coalesce the burst: one trailing publish carries the newest bytes.
    if (trailingHandle === null) {
      const delay = PROGRESS_THROTTLE_MS - (now - lastEmitTime);
      trailingHandle = clock.setTimeout(() => {
        trailingHandle = null;
        if (disposed) return;
        publish(clock.now());
      }, Math.max(0, delay));
    }
  }

  function flush(): void {
    if (disposed || !established) return;
    clearTrailing();
    publish(clock.now());
  }

  return { observe, flush, dispose };
}
