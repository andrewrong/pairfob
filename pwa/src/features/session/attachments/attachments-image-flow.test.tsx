import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { unmountReact } from "../../../../test-support/react-harness";
import { setScreen } from "../../../app/navigation-store";
import { setLang } from "../../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import { ProtocolError } from "../../../lib/protocol/errors";
import type { LiveSession, PairResult } from "../../../lib/protocol/client";
import { setPhase, setSessionTransport } from "../../connection/connection-store";
import { applyCapabilities } from "../../operations/capabilities-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { selectPane, setFullTerminal } from "../session-store";
import { setComposeDraft } from "../compose-store";
import { resetComposeDrafts } from "../drafts/compose-drafts";
import {
  addPickedFiles,
  resumeUpload,
  setAttachmentTransferPort,
  settleTransferQueue,
  startUpload,
} from "./attachments-controller";
import { setImagePreparer } from "./attachments-image";
import {
  resetAttachmentQueues,
  attachmentScopeKey,
  queueSnapshot,
  runtimeCheckpoint,
  setPreference,
  setRuntimeCheckpoint,
} from "./attachments-store";
import type {
  AttachmentCheckpoint,
  AttachmentTransferPort,
  UploadStateLike,
} from "./attach-model";

const SCOPE = { daemonId: "d1", paneId: "p1" } as const;
const KEY = attachmentScopeKey(SCOPE);

const session = {
  isConnected: () => true,
  sendText: async () => {},
  sendKeys: async () => {},
  promptAgent: async () => {},
} as unknown as LiveSession;

type FlowPort = AttachmentTransferPort & {
  uploaded: File[];
  resumed: File[];
  lastCommitted: UploadStateLike | null;
};

function makeFlowPort(): FlowPort {
  const uploaded: File[] = [];
  const resumed: File[] = [];
  let lastCommitted: UploadStateLike | null = null;
  let uploadCount = 0;
  const port: AttachmentTransferPort = {
    limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
    async upload(_session, paneId, file, options) {
      uploaded.push(file);
      uploadCount += 1;
      // First smart upload fails BEFORE any checkpoint; the second emits the
      // checkpoint (built from the received file) then turns uncertain.
      if (uploadCount === 1) throw new ProtocolError("internal", "boom");
      await options?.onCheckpoint?.({
        uploadId: `up_${file.name}`, paneId, name: file.name,
        size: file.size, sha256: "a".repeat(64), mime: file.type || "application/octet-stream",
      });
      throw new ProtocolError("unknown_outcome", "uncertain");
    },
    async resume(_session, checkpoint, file) {
      resumed.push(file);
      lastCommitted = {
        upload_id: checkpoint.uploadId, state: "committed", offset: file.size,
        size: file.size, sha256: "a".repeat(64), chunk_bytes: 32768,
        path: "/tmp/demo/.pairfob/attachments/abcd1234/attachment.jpg",
      };
      return lastCommitted;
    },
    async inspect(_session, checkpoint) {
      const checkpointed: AttachmentCheckpoint = checkpoint;
      return {
        upload_id: checkpointed.uploadId, state: "uploading", offset: 0,
        size: checkpointed.size, sha256: checkpointed.sha256, chunk_bytes: 32768,
      };
    },
    async cancel(_session, checkpoint) {
      return {
        upload_id: checkpoint.uploadId, state: "cancelled", offset: 0,
        size: checkpoint.size, sha256: checkpoint.sha256, chunk_bytes: 32768,
      };
    },
  };
  return { ...port, uploaded, resumed, get lastCommitted() { return lastCommitted; } };
}

let flowPort: FlowPort;

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
  setComposeDraft("");
  flowPort = makeFlowPort();
  setAttachmentTransferPort(flowPort);
});

afterEach(async () => {
  unmountReact();
  setImagePreparer(null);
  setAttachmentTransferPort(null);
  attachLiveSession(null);
  setCredential(null);
  setFullTerminal(false);
  resetAttachmentQueues();
  resetComposeDrafts();
  await settleTransferQueue();
});

async function settle(): Promise<void> {
  await act(async () => { await settleTransferQueue(); });
}

describe("smart image upload flow through the real controller", () => {
  test("smart failure before checkpoint; preference switch reuses cache; resume commits the same file", async () => {
    const source = new File([new Uint8Array(500000)], "photo.jpeg", { type: "image/jpeg" });
    const compressed = new File([new Uint8Array(50000)], "photo.jpg", { type: "image/jpeg" });
    let preparerCalls = 0;
    setImagePreparer(async (file) => {
      preparerCalls += 1;
      return { file: compressed, changed: true, originalBytes: file.size, reason: "compressed" };
    });

    await act(async () => { await addPickedFiles(SCOPE, [source]); });
    const id = queueSnapshot(KEY)!.items[0].localId;

    // First smart upload compresses, then fails BEFORE the checkpoint exists.
    act(() => startUpload(SCOPE, id));
    await settle();
    let item = queueSnapshot(KEY)!.items[0]!;
    expect(item.status).toBe("error");
    expect(item.recoverable).toBe(false);
    expect(runtimeCheckpoint(KEY, id)).toBeNull();
    expect(flowPort.uploaded).toHaveLength(1);
    expect(flowPort.uploaded[0]).toBe(compressed);

    // Switching original then smart resets the upload file to the source but
    // preserves the cached compressed result.
    act(() => setPreference(KEY, id, "original"));
    act(() => setPreference(KEY, id, "smart"));

    // Second upload reuses the cached compressed file, emits a checkpoint
    // (from the received file), then turns uncertain (recoverable).
    act(() => startUpload(SCOPE, id));
    await settle();
    item = queueSnapshot(KEY)!.items[0]!;
    expect(item.status).toBe("error");
    expect(item.recoverable).toBe(true);
    expect(runtimeCheckpoint(KEY, id)).not.toBeNull();
    expect(flowPort.uploaded).toHaveLength(2);
    expect(flowPort.uploaded[1]).toBe(compressed);

    // Explicit resume reads status via the retained checkpoint and commits
    // with the SAME compressed file object.
    act(() => resumeUpload(SCOPE, id));
    await settle();
    item = queueSnapshot(KEY)!.items[0]!;
    expect(item.status).toBe("committed");
    expect(flowPort.resumed).toHaveLength(1);
    expect(flowPort.resumed[0]).toBe(compressed);

    // The preparer decoded the source exactly once; both uploads and the
    // resume all used the one compressed result.
    expect(preparerCalls).toBe(1);

    // Row identity reflects the compressed upload file, not the source.
    expect(item).toMatchObject({ name: "photo.jpg", size: 50000, mime: "image/jpeg", acknowledged: 50000 });

    // Committed state is a valid absolute path and carries the received file
    // size/offset plus a 64-hex sha256 and 32768-byte chunks.
    const committed = flowPort.lastCommitted!;
    expect(committed.path.startsWith("/")).toBe(true);
    expect(committed.path).toContain(".pairfob/attachments/abcd1234/attachment.jpg");
    expect(item.path).toBe(committed.path);
    expect(committed.size).toBe(50000);
    expect(committed.offset).toBe(50000);
    expect(committed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(committed.chunk_bytes).toBe(32768);
  });

  test("a checkpoint injected mid-prepare blocks the Begin and retains the handle", async () => {
    const source = new File([new Uint8Array(500000)], "photo.jpeg", { type: "image/jpeg" });
    const compressed = new File([new Uint8Array(50000)], "photo.jpg", { type: "image/jpeg" });
    let resolvePrepare!: (r: { file: File; changed: boolean; originalBytes: number; reason: "compressed" }) => void;
    const pending = new Promise<{ file: File; changed: boolean; originalBytes: number; reason: "compressed" }>(
      (resolve) => { resolvePrepare = resolve; },
    );
    let preparerCalled = false;
    setImagePreparer(() => {
      preparerCalled = true;
      return pending;
    });

    await act(async () => { await addPickedFiles(SCOPE, [source]); });
    const id = queueSnapshot(KEY)!.items[0].localId;

    act(() => startUpload(SCOPE, id));
    // Let the serial job reach the (pending) preparer.
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
    expect(preparerCalled).toBe(true);
    expect(queueSnapshot(KEY)?.items[0].compressing).toBe(true);

    // Inject a Begin checkpoint while the codec is still preparing; the result
    // must NOT start a wire upload or replace the in-flight identity.
    const checkpoint: AttachmentCheckpoint = {
      uploadId: "up_photo.jpg", paneId: "p1", name: "photo.jpg",
      size: 50000, sha256: "a".repeat(64), mime: "image/jpeg",
    };
    setRuntimeCheckpoint(KEY, id, checkpoint);
    resolvePrepare({ file: compressed, changed: true, originalBytes: 500000, reason: "compressed" });
    await settle();

    // No Begin reached the port, the checkpoint is retained, and the row is a
    // recoverable error with no stuck preparing/compressing state.
    expect(flowPort.uploaded).toHaveLength(0);
    expect(flowPort.resumed).toHaveLength(0);
    expect(runtimeCheckpoint(KEY, id)).not.toBeNull();
    expect(queueSnapshot(KEY)?.items[0]).toMatchObject({ status: "error", recoverable: true, compressing: false });
  });
});