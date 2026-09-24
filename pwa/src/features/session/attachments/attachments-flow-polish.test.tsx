import { act } from "react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { closeTestDialogs } from "../../../../test-support/close-dialogs";
import { setLang } from "../../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import type { LiveSession, PairResult } from "../../../lib/protocol/client";
import { setPhase, setSessionTransport, setTransportSwitching, applyOriginConfig, setNetworkMode } from "../../connection/connection-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { applyCapabilities } from "../../operations/capabilities-store";
import { selectPane } from "../session-store";
import { checkUpload, startUpload, startAllQueued, settleTransferQueue, setAttachmentTransferPort } from "./attachments-controller";
import { adoptIncoming, attachmentScopeKey, patchItem, queueSnapshot, resetAttachmentQueues, runtimeCheckpoint, runtimePreparedImage, setRuntimeCheckpoint } from "./attachments-store";
import { resetAttachmentRecovery, setAttachmentJournalBackend } from "./attachments-recovery";
import { setImagePreparer } from "./attachments-image";
import { setThumbnailPreparer } from "./attachments-thumbnails";
import type { AttachmentTransferPort, AttachmentCheckpoint } from "./attach-model";

const scope = { daemonId: "d_polish", paneId: "p1" };
const key = attachmentScopeKey(scope);
const file = (name: string, image = false) => new File([new Uint8Array(image ? 700000 : 3)], name, { type: image ? "image/jpeg" : "application/octet-stream" });
const row = (id: string) => queueSnapshot(key)!.items.find(i => i.localId === id)!;
const checkpoint = (f: File): AttachmentCheckpoint => ({ uploadId: "12345678-1234-4234-8234-123456789abc", paneId: "p1", name: f.name, mime: f.type, size: f.size, sha256: "a".repeat(64) });
let gates: Array<() => void> = [];
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); gates.push(resolve); return { promise, resolve }; }
async function pump() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
let session: LiveSession;
let port: AttachmentTransferPort;
let uploads: File[], prepared: string[], inspections: number, switches: number;
let switchAction: () => Promise<void>;

beforeEach(async () => {
  gates = [];
  await resetBoardTestDOM(); setLang("en");
  resetAttachmentRecovery(); resetAttachmentQueues();
  setPhase("live"); selectPane("p1"); setSessionTransport("p2p"); setTransportSwitching(false);
  applyOriginConfig({ protocol: 2, p2p: true }); setNetworkMode("relay");
  setCredential({ daemonId: scope.daemonId } as PairResult);
  switches = 0;
  switchAction = async () => { setSessionTransport("p2p"); };
  session = { isConnected: () => true, isChecking: () => false,
    switchTransport: async () => { switches++; await switchAction(); } } as unknown as LiveSession;
  attachLiveSession(session);
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, upload_file: true }, []);
  setThumbnailPreparer(async () => null);
  setAttachmentJournalBackend({ put: async () => {}, remove: async () => {}, list: async () => [], clearDaemon: async () => {} });
  uploads = []; prepared = []; inspections = 0;
  setImagePreparer(async f => { prepared.push(f.name); return { file: new File(["small"], f.name, { type: "image/jpeg" }), originalBytes: f.size, changed: true, reason: "compressed" }; });
  port = {
    limits: { maxFileBytes: 20971520, maxBatchBytes: 41943040, maxFiles: 5 },
    upload: async (_s, _p, f) => { uploads.push(f); return { upload_id: "u", state: "committed", offset: f.size, size: f.size, sha256: "a".repeat(64), chunk_bytes: 32768, path: "/tmp/.pairfob/attachments/x/attachment.bin" }; },
    resume: async () => { throw Error("resume must be explicit"); },
    inspect: async (_s, cp) => { inspections++; return { upload_id: cp.uploadId, state: "uploading", offset: 1, size: cp.size, sha256: cp.sha256, chunk_bytes: 32768 }; },
    cancel: async () => { throw Error("unused"); },
  };
  setAttachmentTransferPort(port);
});
afterEach(async () => {
  closeTestDialogs(); resetAttachmentRecovery(); resetAttachmentQueues(); gates.forEach(resolve => resolve());
  await settleTransferQueue(); setImagePreparer(null); setThumbnailPreparer(null);
  setAttachmentTransferPort(null); attachLiveSession(null); setCredential(null);
  setTransportSwitching(false);
});

// The controller itself never auto-starts; the tray's auto-start (see
// attachment-tray.test.tsx) is what reacts to P2P returning.
test("Relay queue does no compression or upload and P2P restoration never auto-starts it", async () => {
  const [id] = adoptIncoming(key, scope, [file("a.jpg", true)]);
  setSessionTransport("relay"); startUpload(scope, id); await settleTransferQueue();
  expect(prepared).toEqual([]); expect(uploads).toEqual([]);
  expect(row(id)).toMatchObject({ status: "queued", scheduled: false, transferPhase: "waiting-p2p" });
  setSessionTransport("p2p"); await pump(); expect(uploads).toEqual([]);
  startUpload(scope, id); await settleTransferQueue();
  expect(prepared).toEqual(["a.jpg"]); expect(uploads).toHaveLength(1);
});

test("one-ahead prepared image is reused; a third image never prepares after P2P loss", async () => {
  const ids = adoptIncoming(key, scope, [file("a.jpg", true), file("b.jpg", true), file("c.jpg", true)]);
  const gate = deferred(), entered = deferred(); const upload = port.upload;
  port.upload = async (...args) => { entered.resolve(); await gate.promise; return upload(...args); };
  await startAllQueued(scope); await entered.promise; await pump();
  expect(prepared).toEqual(["a.jpg", "b.jpg"]);
  const cached = runtimePreparedImage(key, ids[1]); expect(cached).toBeTruthy();
  await act(async () => { setSessionTransport("relay"); gate.resolve(); await settleTransferQueue(); });
  expect(uploads).toHaveLength(1); expect(prepared).toEqual(["a.jpg", "b.jpg"]);
  expect(row(ids[1]).transferPhase).toBe("waiting-p2p"); expect(row(ids[2]).transferPhase).toBe("waiting-p2p");
  setSessionTransport("p2p"); await pump(); expect(uploads).toHaveLength(1);
  await startAllQueued(scope); await settleTransferQueue();
  expect(prepared).toEqual(["a.jpg", "b.jpg", "c.jpg"]); expect(uploads).toHaveLength(3);
});

test("read-only status works on Relay and never resumes", async () => {
  const f = file("a.bin"); const [id] = adoptIncoming(key, scope, [f]);
  setRuntimeCheckpoint(key, id, checkpoint(f)); patchItem(key, id, { status: "error", recoverable: true });
  setSessionTransport("relay");
  await act(async () => { await checkUpload(scope, id); await settleTransferQueue(); });
  expect(inspections).toBe(1); expect(uploads).toHaveLength(0);
  expect(row(id)).toMatchObject({ status: "error", recoverable: true, acknowledged: 1 });
});

test("checkpoint persistence has its own phase and cannot send Begin before saving settles", async () => {
  const gate = deferred(), entered = deferred(); let begins = 0;
  setAttachmentJournalBackend({ put: async () => { entered.resolve(); await gate.promise; }, remove: async () => {}, list: async () => [], clearDaemon: async () => {} });
  const upload = port.upload;
  port.upload = async (s, pane, f, opts) => {
    opts?.onStage?.("hashing"); await opts?.onCheckpoint?.(checkpoint(f));
    if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    begins++; opts?.onStage?.("begin"); return upload(s, pane, f, opts);
  };
  const [id] = adoptIncoming(key, scope, [file("a.bin")]);
  await act(async () => { startUpload(scope, id); await entered.promise; });
  expect(row(id).transferPhase).toBe("persisting"); expect(begins).toBe(0);
  await act(async () => { setSessionTransport("relay"); gate.resolve(); await settleTransferQueue(); });
  expect(begins).toBe(0); expect(runtimeCheckpoint(key, id)).toBeNull();
  expect(row(id).transferPhase).toBe("waiting-p2p");
  expect(row(id).stageTimings?.persistence).toBeGreaterThanOrEqual(0);
});

test("a failed read-only status check does not claim the user cancelled", async () => {
  const f = file("a.bin"); const [id] = adoptIncoming(key, scope, [f]);
  setRuntimeCheckpoint(key, id, checkpoint(f)); patchItem(key, id, { status: "error", recoverable: true, acknowledged: 1 });
  port.inspect = async () => { throw Error("unavailable"); };
  setSessionTransport("relay");
  await act(async () => { await checkUpload(scope, id); await settleTransferQueue(); });
  expect(row(id)).toMatchObject({ acknowledged: 1, recoverable: true, cancelIntent: false });
  expect(row(id).errorText).toContain("Could not check upload status");
  expect(runtimeCheckpoint(key, id)).toBeTruthy();
});
