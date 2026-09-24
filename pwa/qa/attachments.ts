import { lang } from "../src/lib/i18n";
import { attachT } from "../src/features/session/attachments/attach-copy";
import { currentDaemonId } from "../src/features/computers/catalog-store";
import { setAttachmentTransferPort } from "../src/features/session/attachments/attachments-controller";
import { resetAttachmentRecovery, setAttachmentJournalBackend } from "../src/features/session/attachments/attachments-recovery";
import {
  adoptIncoming, attachmentScopeKey, patchItem, resetAttachmentQueues, setRuntimeCheckpoint,
} from "../src/features/session/attachments/attachments-store";
import { setThumbnailPreparer } from "../src/features/session/attachments/attachments-thumbnails";
import { resetTrayActions } from "../src/features/session/attachments/attachments-tray-actions";
import type {
  AttachmentCheckpoint, AttachmentTransferPort, UploadStateLike,
} from "../src/features/session/attachments/attach-model";
import { PANE, ROOT } from "./data";

/**
 * Attachment tray fixture.
 *
 * Every scene starts with an empty tray, an in-memory journal (nothing from a
 * real IndexedDB is restored) and a local transfer port that "uploads" in a
 * few steps, so picking or pasting in the QA page runs the real tray flow
 * without a computer. Thumbnails are drawn from each file's name, so seeded
 * image rows look like images without shipping binary fixtures.
 */

const STEP_MS = 180;
const STEPS = 8;
const SHA = "a".repeat(64);

const pathFor = (name: string) => `${ROOT}/.pairfob/attachments/qa/${name}`;

function committed(checkpoint: AttachmentCheckpoint): UploadStateLike {
  return {
    upload_id: checkpoint.uploadId, state: "committed", offset: checkpoint.size, size: checkpoint.size,
    sha256: SHA, chunk_bytes: 32768, path: pathFor(checkpoint.name),
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

let uploads = 0;

const fixturePort: AttachmentTransferPort = {
  limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
  async upload(_session, paneId, file, options) {
    const checkpoint: AttachmentCheckpoint = {
      uploadId: `qa-upload-${++uploads}`, paneId, name: file.name, size: file.size, sha256: SHA,
      mime: file.type || "application/octet-stream",
    };
    options?.onStage?.("hashing");
    await options?.onCheckpoint?.(checkpoint);
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    options?.onStage?.("sending");
    for (let step = 1; step <= STEPS; step++) {
      await delay(STEP_MS, options?.signal);
      options?.onProgress?.(Math.round((file.size * step) / STEPS), file.size);
    }
    options?.onStage?.("commit");
    return committed(checkpoint);
  },
  async resume(_session, checkpoint, _file, options) {
    await delay(STEP_MS, options?.signal);
    options?.onProgress?.(checkpoint.size, checkpoint.size);
    return committed(checkpoint);
  },
  async inspect(_session, checkpoint) {
    return { upload_id: checkpoint.uploadId, state: "uploading", offset: Math.floor(checkpoint.size / 3), size: checkpoint.size, sha256: SHA, chunk_bytes: 32768 };
  },
  async cancel(_session, checkpoint) {
    return { upload_id: checkpoint.uploadId, state: "cancelled", offset: 0, size: checkpoint.size, sha256: SHA, chunk_bytes: 32768 };
  },
};

const HUES = [212, 28, 146, 268, 342];

/** A small SVG "photo" per file name: stable colors, no binary fixtures. */
async function fixtureThumbnail(file: File): Promise<Blob | null> {
  let hash = 0;
  for (const char of file.name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = HUES[hash % HUES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 62%)"/>`
    + `<stop offset="1" stop-color="hsl(${(hue + 50) % 360} 55% 28%)"/></linearGradient></defs>`
    + `<rect width="96" height="96" fill="url(#g)"/><circle cx="68" cy="28" r="10" fill="hsl(48 90% 80%)"/>`
    + `<path d="M0 78 L30 50 L52 70 L70 56 L96 80 L96 96 L0 96 Z" fill="hsl(${hue} 30% 18%)"/></svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

/** Empty tray, in-memory journal, fixture port and thumbnails — for every scene. */
export function resetAttachmentFixture(): void {
  resetTrayActions();
  resetAttachmentRecovery();
  resetAttachmentQueues();
  setAttachmentJournalBackend({
    put: async () => {}, remove: async () => {}, list: async () => [], clearDaemon: async () => {},
  });
  setAttachmentTransferPort(fixturePort);
  setThumbnailPreparer(fixtureThumbnail);
}

function fakeFile(name: string, bytes: number, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const KiB = 1024;

/**
 * Seed the guided pane's tray. `p2p` scenes show every state the reader can
 * meet with a direct connection up; the relay scene shows fresh picks waiting
 * for one. Returns the draft text (it holds the in-body path).
 */
export function seedAttachmentTray(variant: "p2p" | "relay"): string {
  const scope = { daemonId: currentDaemonId(), paneId: PANE };
  const key = attachmentScopeKey(scope);
  if (variant === "relay") {
    adoptIncoming(key, scope, [
      fakeFile("whiteboard.jpg", 2400 * KiB, "image/jpeg"),
      fakeFile("trace.log", 180 * KiB, "text/plain"),
    ]);
    return lang() === "zh" ? "对照这张白板照片检查一下流程" : "Check the flow against this whiteboard photo";
  }
  const [inBody, ready, uploading, failed, restored] = adoptIncoming(key, scope, [
    fakeFile("error-screenshot.png", 640 * KiB, "image/png"),
    fakeFile("whiteboard.jpg", 2400 * KiB, "image/jpeg"),
    fakeFile("design-notes.md", 12 * KiB, "text/markdown"),
    fakeFile("trace.log", 180 * KiB, "text/plain"),
    fakeFile("floor-plan.jpg", 3100 * KiB, "image/jpeg"),
  ]);
  const body = pathFor("error-screenshot.png");
  patchItem(key, inBody, { status: "committed", acknowledged: 640 * KiB, path: body, inserted: true,
    compressionReason: "preserved", transferTransport: "p2p", stageTimings: { hashing: 12, sending: 840, commit: 30 } });
  patchItem(key, ready, { status: "committed", acknowledged: 610 * KiB, path: pathFor("whiteboard.jpg"),
    size: 610 * KiB, originalBytes: 2400 * KiB, compressionReason: "compressed", compressionChanged: true,
    outputWidth: 2048, outputHeight: 1536, transferTransport: "p2p" });
  patchItem(key, uploading, { status: "uploading", acknowledged: 7 * KiB, transferPhase: "sending",
    speedBps: 320 * KiB, etaSeconds: 1 });
  patchItem(key, failed, { status: "error", errorText: attachT("err.expired") });
  setRuntimeCheckpoint(key, restored, {
    uploadId: "qa-restored", paneId: PANE, name: "floor-plan.jpg", size: 3100 * KiB, sha256: SHA, mime: "image/jpeg",
  });
  patchItem(key, restored, { status: "error", recoverable: true, restored: true, acknowledged: 1200 * KiB });
  return lang() === "zh"
    ? `看一下 ${body} 里的报错，顺便对照白板上的流程`
    : `Look at the error in ${body}, then compare with the whiteboard flow`;
}
