// Wait-before-first-send readiness gate for attachment upload mutations.
//
// A navigator.connection change makes DirectSessionDriver.probe re-verify the
// LIVE epoch with an encrypted Ping and publishes a public "checking" event
// even when the socket is healthy. Interactive controls must keep failing
// immediately during that window, but a long attachment upload must PAUSE its
// next not-yet-sent chunk until the same epoch is confirmed, instead of
// rejecting it during an 8 ms probe.
//
// This gate is only the bookkeeping: one bounded waiter per unsent upload
// mutation, one deadline timer each, zero per-waiter DOM listeners (the
// session pulses it from its single event flow and from explicit internal
// invalidations). It never sends, retries or migrates an RPC to another
// epoch; the session re-checks transport identity and switch generation
// synchronously before and after waiting.
import { ProtocolError } from "./errors.ts";

/** Exact upload mutation names that may pause while the live epoch is probed. */
export const UPLOAD_MUTATION_OPS: ReadonlySet<string> = new Set([
  "WorkspaceUploadBegin",
  "WorkspaceUploadWrite",
  "WorkspaceUploadCommit",
  "WorkspaceUploadCancel",
  "WorkspaceUploadBeginV2",
  "WorkspaceUploadWriteV2",
  "WorkspaceUploadCommitV2",
  "WorkspaceUploadCancelV2",
]);

export function isUploadMutation(op: string): boolean {
  return UPLOAD_MUTATION_OPS.has(op);
}

/** A probe on a healthy relay answers within milliseconds; 8 s is the hard bound. */
export const UPLOAD_READINESS_WAIT_MS = 8_000;
/** Matches the V2 write window; legacy uploads are serial, so this is never hit. */
export const UPLOAD_READINESS_MAX_CONCURRENT_WAITS = 4;

export function uploadWaitTimeoutError(): ProtocolError {
  return new ProtocolError("timeout", "连接确认超时（8 秒），本次上传操作未发送；请刷新后继续");
}

export function uploadWaitCapError(): ProtocolError {
  return new ProtocolError("backpressure", "上传等待数已达上限，请稍后继续");
}

/**
 * Waiter verdict evaluated synchronously by the session:
 * - true: the captured epoch is still the live one and is ready; dispatch now;
 * - Error: permanently unsendable on this epoch (closed/switched/offline/…);
 * - false: still checking on the same epoch; keep waiting.
 */
export type UploadReadinessCheck = () => boolean | Error;

type UploadWaiter = {
  check: UploadReadinessCheck;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class UploadReadinessGate {
  private readonly waiters = new Set<UploadWaiter>();

  constructor(
    private readonly maxConcurrent: number,
    private readonly waitMs: number,
  ) {}

  /** Number of upload mutations currently paused (test/observability seam). */
  get pendingCount(): number {
    return this.waiters.size;
  }

  /**
   * Run one bounded unsent wait. The verdict is evaluated once before any
   * timer exists, so a ready or invalid session never enqueues and the normal
   * fast path allocates nothing. A false verdict enqueues at most
   * maxConcurrent waiters; the cap rejects visibly instead of growing
   * listeners without bound.
   */
  async wait(check: UploadReadinessCheck): Promise<void> {
    const immediate = check();
    if (immediate === true) return;
    if (immediate instanceof Error) throw immediate;
    if (this.waiters.size >= this.maxConcurrent) throw uploadWaitCapError();
    await new Promise<void>((resolve, reject) => {
      const waiter: UploadWaiter = {
        check,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.drop(waiter);
          reject(uploadWaitTimeoutError());
        }, this.waitMs),
      };
      this.waiters.add(waiter);
    });
  }

  /** Re-evaluate every waiter after a session event; resolve or reject settled ones. */
  pulse(): void {
    for (const waiter of [...this.waiters]) {
      const verdict = waiter.check();
      if (verdict === false) continue;
      this.drop(waiter);
      if (verdict === true) waiter.resolve();
      else waiter.reject(verdict);
    }
  }

  /** Reject every paused upload visibly (close, switch begin, offline, hidden). */
  failAll(error: Error): void {
    for (const waiter of [...this.waiters]) {
      this.drop(waiter);
      waiter.reject(error);
    }
  }

  private drop(waiter: UploadWaiter): void {
    this.waiters.delete(waiter);
    clearTimeout(waiter.timer);
  }
}
