import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { setScreen } from "../../../app/navigation-store";
import { setLang } from "../../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import { ProtocolError } from "../../../lib/protocol/errors";
import type { LiveSession, PairResult } from "../../../lib/protocol/client";
import { setPhase, setSessionTransport } from "../../connection/connection-store";
import { applyCapabilities } from "../../operations/capabilities-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { selectPane, setFullTerminal } from "../session-store";
import { resetComposeDrafts } from "../drafts/compose-drafts";
import {
  addPickedFiles,
  cancelUpload,
  setAttachmentTransferPort,
  settleTransferQueue,
  startUpload,
} from "./attachments-controller";
import {
  resetAttachmentQueues,
  attachmentScopeKey,
  queueSnapshot,
  runtimeCheckpoint,
} from "./attachments-store";
import type {
  AttachmentTransferOptions,
  AttachmentTransferPort,
  UploadStateLike,
} from "./attach-model";

const SCOPE = { daemonId: "d1", paneId: "p1" } as const;
const KEY = attachmentScopeKey(SCOPE);
const COMMITTED_PATH = "/tmp/demo/.pairfob/attachments/abcd/notes.txt";

function file(name: string, size: number): File {
  return new File([new Uint8Array(size)], name);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal deferred port for meter integration: checkpoint v2, live progress,
 *  explicit resolve/reject, and a standard cancelled receipt. */
function meterPort(): AttachmentTransferPort & {
  progress(): ((acknowledged: number, total: number) => void) | null;
  resolveCommitted(): void;
  rejectActive(error: unknown): void;
  calls: readonly string[];
} {
  let resolveCurrent: ((state: UploadStateLike) => void) = () => undefined;
  let rejectCurrent: ((error: unknown) => void) = () => undefined;
  let progressFn: ((acknowledged: number, total: number) => void) | null = null;
  let lastSize = 0;
  const calls: string[] = [];
  const committed = (size: number): UploadStateLike => ({
    upload_id: "u1", state: "committed", offset: size, size,
    sha256: "a".repeat(64), chunk_bytes: 131_072, path: COMMITTED_PATH,
  });
  const port: AttachmentTransferPort = {
    limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
    async upload(_session, paneId, picked, options?: AttachmentTransferOptions) {
      calls.push("upload");
      lastSize = picked.size;
      // The v2 marker is preserved structurally end to end by the UI layer.
      await options?.onCheckpoint?.({
        uploadId: "u1", paneId, name: picked.name, size: picked.size,
        sha256: "a".repeat(64), mime: picked.type || "application/octet-stream", version: 2,
      });
      progressFn = options?.onProgress ?? null;
      return await new Promise<UploadStateLike>((resolve, reject) => {
        resolveCurrent = resolve;
        rejectCurrent = reject;
        options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    },
    resume: async () => { throw new Error("unused in meter tests"); },
    inspect: async () => { throw new Error("unused in meter tests"); },
    async cancel(_session, checkpoint) {
      calls.push("cancel");
      return {
        upload_id: checkpoint.uploadId, state: "cancelled", offset: 0,
        size: checkpoint.size, sha256: "a".repeat(64), chunk_bytes: 131_072,
      };
    },
  };
  return {
    ...port,
    calls,
    progress: () => progressFn,
    resolveCommitted: () => resolveCurrent(committed(lastSize)),
    rejectActive: (error) => rejectCurrent(error),
  };
}

/** A port whose upload promise stays pending even after abort: it never wires
 *  signal rejection, so the cancel job remains serialized behind the upload. */
function pendingPort(): AttachmentTransferPort & {
  progress(): ((acknowledged: number, total: number) => void) | null;
  resolveCancelled(): void;
  settled(): boolean;
  calls: readonly string[];
} {
  let resolveCurrent: ((state: UploadStateLike) => void) = () => undefined;
  let progressFn: ((acknowledged: number, total: number) => void) | null = null;
  let settled = false;
  const calls: string[] = [];
  const port: AttachmentTransferPort = {
    limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
    async upload(_session, paneId, picked, options) {
      calls.push("upload");
      await options?.onCheckpoint?.({
        uploadId: "u1", paneId, name: picked.name, size: picked.size,
        sha256: "a".repeat(64), mime: picked.type || "application/octet-stream", version: 2,
      });
      progressFn = options?.onProgress ?? null;
      // Deliberately ignore options.signal: the promise (and therefore the
      // serial scheduler slot) stays pending until the test resolves it.
      const state = await new Promise<UploadStateLike>((resolve) => { resolveCurrent = resolve; });
      settled = true;
      return state;
    },
    resume: async () => { throw new Error("unused in pending tests"); },
    inspect: async () => { throw new Error("unused in pending tests"); },
    async cancel(_session, checkpoint) {
      calls.push("cancel");
      return {
        upload_id: checkpoint.uploadId, state: "cancelled", offset: 0,
        size: checkpoint.size, sha256: "a".repeat(64), chunk_bytes: 131_072,
      };
    },
  };
  return {
    ...port,
    calls,
    progress: () => progressFn,
    settled: () => settled,
    resolveCancelled: () => resolveCurrent({
      upload_id: "u1", state: "cancelled", offset: 0, size: 1_048_576,
      sha256: "a".repeat(64), chunk_bytes: 131_072,
    }),
  };
}

let port: ReturnType<typeof meterPort>;
const session = { isConnected: () => true } as unknown as LiveSession;

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("en");
  setPhase("live"); setSessionTransport("p2p");
  setScreen("pane");
  selectPane("p1");
  setFullTerminal(false);
  setCredential({ daemonId: "d1" } as unknown as PairResult);
  attachLiveSession(session);
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, upload_file: true } as never, []);
  resetComposeDrafts();
  resetAttachmentQueues();
  port = meterPort();
  setAttachmentTransferPort(port);
});

afterEach(async () => {
  setAttachmentTransferPort(null);
  attachLiveSession(null);
  setCredential(null);
  setFullTerminal(false);
  resetAttachmentQueues();
  resetComposeDrafts();
  await settleTransferQueue();
});

async function startJob(name: string, size: number): Promise<string> {
  await act(async () => { await addPickedFiles(SCOPE, [file(name, size)]); });
  const id = queueSnapshot(KEY)!.items[0].localId;
  act(() => startUpload(SCOPE, id));
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
  return id;
}

describe("upload meter integrated with the controller", () => {
  test("shows a measured rate only while uploading, clears it on completion and drops late callbacks", async () => {
    const id = await startJob("m.txt", 8);
    expect(runtimeCheckpoint(KEY, id)?.version).toBe(2);
    act(() => port.progress()?.(4, 8));
    expect(queueSnapshot(KEY)?.items[0]).toMatchObject({ status: "uploading", acknowledged: 4 });
    // The first acknowledged sample is the baseline: no invented rate.
    expect(queueSnapshot(KEY)?.items[0].speedBps).toBeUndefined();
    await act(async () => wait(120));
    act(() => port.progress()?.(6, 8));
    await act(async () => wait(200)); // let the 150ms trailing timer flush
    const uploading = queueSnapshot(KEY)?.items[0]!;
    expect(uploading.status).toBe("uploading");
    expect(Number.isFinite(uploading.speedBps)).toBe(true);
    expect(uploading.speedBps!).toBeGreaterThan(0);
    expect(uploading.etaSeconds).toBeGreaterThan(0);
    expect(uploading.waiting).toBe(false);

    act(() => port.resolveCommitted());
    await act(async () => settleTransferQueue());
    const done = queueSnapshot(KEY)?.items[0]!;
    expect(done).toMatchObject({ status: "committed", acknowledged: 8 });
    expect(done.speedBps).toBeUndefined();
    expect(done.etaSeconds).toBeUndefined();
    expect(done.waiting).toBe(false);

    // A late progress callback from the settled attempt cannot touch the row.
    act(() => port.progress()?.(0, 8));
    expect(queueSnapshot(KEY)?.items[0]).toMatchObject({ status: "committed", acknowledged: 8 });
  });

  test("a failure preserves the latest acknowledged bytes and clears rate fields", async () => {
    const id = await startJob("slow.txt", 8);
    act(() => port.progress()?.(5, 8));
    await act(async () => wait(120));
    act(() => port.progress()?.(6, 8));
    await act(async () => wait(200));
    expect(queueSnapshot(KEY)?.items[0].speedBps).toBeGreaterThan(0);
    act(() => port.rejectActive(new ProtocolError("timeout", "slow")));
    await act(async () => settleTransferQueue());
    const failed = queueSnapshot(KEY)?.items[0]!;
    expect(failed.status).toBe("error");
    expect(failed.recoverable).toBe(true);
    expect(failed.acknowledged).toBe(6); // latest confirmed bytes survive the error
    expect(failed.speedBps).toBeUndefined();
    expect(failed.etaSeconds).toBeUndefined();
    expect(failed.waiting).toBe(false);
  });

  test("cancel disposes meter timers so no trailing/stall update can rewrite the cancelled row", async () => {
    const id = await startJob("c.txt", 8);
    act(() => port.progress()?.(4, 8));
    await act(async () => wait(120));
    act(() => port.progress()?.(6, 8));
    await act(async () => wait(200));
    act(() => cancelUpload(SCOPE, id));
    await act(async () => settleTransferQueue());
    const cancelled = queueSnapshot(KEY)?.items[0]!;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.acknowledged).toBe(6); // bytes preserved, rate hidden
    expect(cancelled.speedBps).toBeUndefined();
    expect(cancelled.waiting).toBe(false);
    expect(port.calls).toEqual(["upload", "cancel"]);
    // Past both the throttle and stall windows: no late timer resurrects state.
    await act(async () => wait(3_200));
    expect(queueSnapshot(KEY)?.items[0].status).toBe("cancelled");
    expect(queueSnapshot(KEY)?.items[0].waiting).toBe(false);
  });

  test("abort disposes the pending trailing/stall timers while the upload promise stays pending", async () => {
    const pending = pendingPort();
    setAttachmentTransferPort(pending);
    const id = await startJob("p.txt", 1_048_576);
    act(() => pending.progress()?.(524_288, 1_048_576)); // baseline: publishes, arms stall
    await act(async () => wait(120));
    act(() => pending.progress()?.(600_000, 1_048_576)); // inside the window: one trailing timer queued
    // Cancel claims and aborts BEFORE either timer fires. The abort signal must
    // dispose the meter even though the upload promise never settles.
    act(() => cancelUpload(SCOPE, id));
    expect(queueSnapshot(KEY)?.items[0].status).toBe("cancelling");
    expect(pending.settled()).toBe(false); // the cancel job is queued behind upload
    // The second sample rode only the trailing edge, so disposing that timer
    // leaves acknowledged at the last PUBLISHED value with no waiting flip.
    const frozen = { status: "cancelling", acknowledged: 524_288, waiting: false };
    // Past the 150ms trailing window: no timer-driven row update.
    await act(async () => wait(250));
    expect(queueSnapshot(KEY)?.items[0]).toMatchObject(frozen);
    // Past the 3s stall window as well: a disposed stall timer flips nothing.
    await act(async () => wait(3_200));
    expect(queueSnapshot(KEY)?.items[0]).toMatchObject(frozen);
    expect(pending.settled()).toBe(false);
    // Cleanup: release the pending upload as a confirmed cancel so the serial
    // cancel job runs and the queue drains for afterEach (never awaited above).
    act(() => pending.resolveCancelled());
    await act(async () => settleTransferQueue());
    expect(queueSnapshot(KEY)?.items[0].status).toBe("cancelled");
    expect(pending.calls).toEqual(["upload", "cancel"]);
  });
});
