import type { ConnectionDetails } from "./connection-diagnostics.ts";
import type { Frame } from "./envelope.ts";
import { ProtocolError } from "./errors.ts";

export type FrameChannelKind = "relay" | "p2p";

/**
 * Pre-seal write budget for one WHOLE encoded envelope frame. Bulk RPCs
 * (WorkspaceUploadWrite[V2]) wait here BEFORE sealing, so no AEAD nonce is
 * allocated and no sealed frame is ever queued/dropped/reordered while the
 * underlying channel buffer is full. Interactive RPCs never wait here.
 *
 * `bytes` is the full encoded frame length (24 B envelope + AEAD payload);
 * each adapter adds its own wire overhead (P2P fragment headers). Optional:
 * adapters without it (older tests, in-memory loops) are treated as always
 * writable, preserving the previous synchronous-send behavior.
 */
export type WaitWritable = (bytes: number, signal?: AbortSignal, timeoutMs?: number) => Promise<void>;

/** Ordered binary frame transport used by an established Pairfob session. */
export interface FrameChannel {
  readonly kind: FrameChannelKind;
  onDiagnostic?(handler: (details: ConnectionDetails) => void): void;
  diagnosticState?(): ConnectionDetails;
  send(frame: Frame): void;
  /** Resolves once one whole frame of `bytes` fits the bounded send budget. */
  waitWritable?: WaitWritable;
  close(code?: number, reason?: string): void;
  next(timeoutMs: number): Promise<Frame>;
  use(handler: (frame: Frame) => void): void;
  onClose(handler: (error: ProtocolError) => void): () => void;
}

/**
 * Wait until a bulk frame fits, staying at least one frame under the 2 MiB
 * DataChannel hard guard and leaving >=1 MiB control headroom.
 */
export const CHANNEL_WRITE_BUDGET = 1024 * 1024;
/** Bounded poll fallback: a missed drain notification delays a bulk send by at most one tick. */
const WRITABLE_POLL_MS = 16;

export type WriteBudgetWait = {
  /** Current queued wire bytes; null once the channel is closed/not open. */
  backlog: () => number | null;
  /** Whole-frame wire cost this waiter needs room for. */
  need: number;
  /** Backlog + need must be <= limit. */
  limit: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Optional drain notification (RTCDataChannel "bufferedamountlow"). */
  onDrain?: (handler: () => void) => () => void;
  /**
   * Detachable end subscription. MUST return an unsubscribe so every settle
   * removes the reaction — a bulk readiness wait must never retain a close
   * listener (or a .then reaction) until the epoch ends.
   */
  onClose?: (handler: (error: ProtocolError) => void) => () => void;
};

/**
 * Bounded "fits now" waiter: immediate check, drain event plus a short poll
 * fallback (so a missed low-water event cannot stall a bulk upload forever),
 * abort/timeout/close settlement, and strict listener/timer cleanup. Never
 * mutates channel state and never guesses success.
 */
export function waitForWriteBudget({ backlog, need, limit, signal, timeoutMs, onDrain, onClose }: WriteBudgetWait): Promise<void> {
  if (signal?.aborted) return Promise.reject(new ProtocolError("aborted", "写入等待已取消"));
  if (backlog() === null) return Promise.reject(new ProtocolError("disconnected", "连接已断开，写入等待结束"));
  if ((backlog() as number) + need <= limit) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeDrain: (() => void) | undefined;
    let unsubscribeClose: (() => void) | undefined;

    const cleanup = (): void => {
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      unsubscribeDrain?.();
      unsubscribeClose?.();
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error?: ProtocolError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const check = (): void => {
      const queued = backlog();
      if (queued === null) { finish(new ProtocolError("disconnected", "连接已断开，写入等待结束")); return; }
      if (queued + need <= limit) finish();
    };
    const poll = (): void => {
      check();
      if (!settled) pollTimer = globalThis.setTimeout(poll, WRITABLE_POLL_MS);
    };
    const onAbort = (): void => finish(new ProtocolError("aborted", "写入等待已取消"));
    const onClosed = (error: ProtocolError): void => finish(error);

    signal?.addEventListener("abort", onAbort, { once: true });
    unsubscribeDrain = onDrain?.(() => check());
    unsubscribeClose = onClose?.(onClosed);
    pollTimer = globalThis.setTimeout(poll, WRITABLE_POLL_MS);
    if (timeoutMs !== undefined) {
      deadlineTimer = globalThis.setTimeout(
        () => finish(new ProtocolError("timeout", "等待发送缓冲区就绪超时；写操作不会自动重试")),
        timeoutMs,
      );
    }
    // Re-check after registration: the buffer may have drained between the
    // fast-path check and listener setup.
    check();
  });
}
