// Bounded in-flight window scheduler for V2 attachment writes. The window
// size (4) is fixed by the V2 wire contract; this module is pure scheduling
// logic and never touches files, sessions, or the DOM. The caller supplies
// `send`, which must resolve with the server-confirmed durable end offset for
// that exact write.
import { ProtocolError } from "./protocol/errors.ts";

export const UPLOAD_WINDOW_MAX_IN_FLIGHT = 4;

export type WindowWrite = {
  /** Inclusive start offset of the chunk to send. */
  offset: number;
  /** Exclusive end offset of the chunk to send. */
  end: number;
};

export type WindowPumpOptions = {
  signal?: AbortSignal;
  /** Sends one chunk; resolves with the confirmed end offset for this write. */
  send: (write: WindowWrite) => Promise<number>;
  /** Reports the contiguous acknowledged prefix, never the completion order. */
  onProgress?: (acknowledged: number) => void;
};

function windowAbortError(): DOMException {
  return new DOMException("附件传输已取消", "AbortError");
}

type InFlightEntry = {
  settled: boolean;
  observed: Promise<void>;
};

/**
 * Pump `size` bytes in offset order with at most `maxInFlight` chunk writes in
 * flight. Scheduling stops on the first error or abort; already-sent writes
 * are settled (observed, never left as unhandled rejections) before the pump
 * returns or throws. Successes are tracked by start offset, so reordered
 * responses can never jump progress past the contiguous acknowledged prefix.
 */
export async function pumpWindowedUpload(
  size: number,
  fromOffset: number,
  chunkBytes: number,
  maxInFlight: number,
  options: WindowPumpOptions,
): Promise<number> {
  if (!Number.isSafeInteger(size) || size < 0) throw new ProtocolError("conflict", "上传窗口 size 非法");
  if (!Number.isSafeInteger(fromOffset) || fromOffset < 0 || fromOffset > size) {
    throw new ProtocolError("conflict", "上传窗口起始偏移量非法");
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new ProtocolError("conflict", "上传窗口 chunk_bytes 非法");
  // NaN/Infinity/fractional/non-positive concurrency must fail closed instead
  // of silently launching zero chunks (NaN compare) or an unbounded burst, and
  // the V2 wire contract pins the window to 4: a larger caller ask is clamped,
  // never honored.
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight <= 0) {
    throw new ProtocolError("conflict", "上传窗口并发数非法");
  }
  const windowLimit = Math.min(UPLOAD_WINDOW_MAX_IN_FLIGHT, maxInFlight);

  let nextOffset = fromOffset;
  let acknowledged = fromOffset;
  let failure: { error: unknown } | undefined;
  const confirmedEnds = new Map<number, number>();
  const inFlight = new Map<number, InFlightEntry>();

  const stopScheduling = (error: unknown): void => {
    if (failure === undefined) failure = { error };
  };

  const advanceAcknowledged = (): void => {
    let advanced = false;
    for (let end = confirmedEnds.get(acknowledged); end !== undefined; end = confirmedEnds.get(acknowledged)) {
      confirmedEnds.delete(acknowledged);
      acknowledged = end;
      advanced = true;
    }
    if (advanced) options.onProgress?.(acknowledged);
  };

  const launch = (write: WindowWrite): void => {
    const entry: InFlightEntry = { settled: false, observed: Promise.resolve() };
    // The send's rejection is observed here immediately: the tracked promise
    // never rejects, and the first failure is rethrown after settlement.
    entry.observed = (async () => {
      try {
        const confirmed = await options.send(write);
        if (confirmed !== write.end) {
          throw new ProtocolError("conflict", `写入确认偏移量 ${confirmed} 与请求 ${write.end} 不一致`);
        }
        confirmedEnds.set(write.offset, write.end);
        advanceAcknowledged();
      } catch (error) {
        stopScheduling(error);
      } finally {
        entry.settled = true;
      }
    })();
    inFlight.set(write.offset, entry);
  };

  const settleInFlight = async (): Promise<void> => {
    const pending = [...inFlight.values()].map((entry) => entry.observed);
    inFlight.clear();
    await Promise.all(pending);
  };

  const run = async (): Promise<number> => {
    options.onProgress?.(acknowledged);
    while (acknowledged < size && failure === undefined) {
      if (options.signal?.aborted) throw windowAbortError();
      while (failure === undefined && inFlight.size < windowLimit && nextOffset < size) {
        if (options.signal?.aborted) throw windowAbortError();
        const end = Math.min(nextOffset + chunkBytes, size);
        launch({ offset: nextOffset, end });
        nextOffset = end;
      }
      if (inFlight.size === 0) break;
      await Promise.race([...inFlight.values()].map((entry) => entry.observed));
      for (const [start, entry] of inFlight) {
        if (entry.settled) inFlight.delete(start);
      }
    }
    await settleInFlight();
    if (failure !== undefined) throw failure.error;
    if (acknowledged < size) throw new ProtocolError("conflict", "写入窗口结束时文件未被完整确认");
    return acknowledged;
  };

  try {
    return await run();
  } catch (error) {
    // Early exits (abort, invalid arguments) still settle the launched window
    // before the caller sees the error.
    await settleInFlight();
    throw error;
  }
}
