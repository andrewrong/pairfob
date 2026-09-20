import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AttachmentItem, AttachmentCheckpoint } from "./attach-model";
import type { AttachmentJournalRecord } from "../../../lib/attachment-journal-codec";
import {
  abortAttachment,
  adoptEditedFile,
  adoptIncoming,
  adoptRuntime,
  attachmentScopeKey,
  bumpRuntimeGeneration,
  clearRuntimeCheckpoint,
  dropRuntime,
  markInserted,
  patchItem,
  patchStatus,
  publishedQueue,
  queueSnapshot,
  removeAttachment,
  resetAttachmentQueues,
  restoreAttachmentRecord,
  runtimeAbort,
  runtimeCheckpoint,
  runtimeFile,
  runtimeGeneration,
  runtimeObjectUrl,
  runtimePhotoOrigin,
  runtimePreparedImage,
  runtimeSourceFile,
  setItemEditNote,
  setImageIntent,
  setPreference,
  setPreparedImage,
  setQueueNotice,
  setRuntimeAbort,
  setRuntimeCheckpoint,
} from "./attachments-store";
import { setThumbnailPreparer } from "./attachments-thumbnails";

const scopeA = { daemonId: "d1", paneId: "p1" };
const scopeB = { daemonId: "d1", paneId: "p2" };
const keyA = attachmentScopeKey(scopeA);
const keyB = attachmentScopeKey(scopeB);

let issued = 0;
let revoked = 0;
let createdFrom: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

function fakeFile(name: string, size: number, type = ""): File {
  const chunk = new Uint8Array(size);
  return new File([chunk], name, { type });
}

/** Let the serial thumbnail queue's timer/microtask chain fully settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

/** Abort-aware thumbnail fake: a small JPEG/PNG blob, never the source File. */
function abortAwareThumbnail(file: File, options?: { signal?: AbortSignal }): Promise<Blob | null> {
  const error = new DOMException("aborted", "AbortError");
  if (options?.signal?.aborted) return Promise.reject(error);
  return new Promise((resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(error), { once: true });
    setTimeout(() => {
      const type = file.type === "image/png" ? "image/png" : "image/jpeg";
      resolve(new Blob([new Uint8Array([0x10, 0x20, 0x30, 0x40])], { type }));
    }, 0);
  });
}

beforeEach(() => {
  issued = 0;
  revoked = 0;
  createdFrom = [];
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    createdFrom.push(blob as Blob);
    return `blob:test/${++issued}`;
  };
  URL.revokeObjectURL = () => { revoked += 1; };
  resetAttachmentQueues();
  setThumbnailPreparer(abortAwareThumbnail);
});

afterEach(() => {
  setThumbnailPreparer(null);
  resetAttachmentQueues();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe("per-pane attachment queues", () => {
  test("different panes keep independent queues and snapshots are frozen", () => {
    adoptIncoming(keyA, scopeA, [fakeFile("a.txt", 10)]);
    adoptIncoming(keyB, scopeB, [fakeFile("b.txt", 20)]);
    expect(queueSnapshot(keyA)?.items).toHaveLength(1);
    expect(queueSnapshot(keyB)?.items).toHaveLength(1);
    expect(queueSnapshot(keyA)?.items[0].name).toBe("a.txt");
    const frozen = publishedQueue(keyA)!;
    expect(() => { (frozen.items as AttachmentItem[]).push = (() => true) as never; }).toThrow();
  });

  test("holds the picked File and a thumbnail-only URL, revoking it on removal", async () => {
    const [localId] = adoptIncoming(keyA, scopeA, [fakeFile("a.jpg", 11, "image/jpeg")]);
    expect(runtimeFile(keyA, localId)?.name).toBe("a.jpg");
    // Placeholder until the serial thumbnail producer finishes.
    expect(runtimeObjectUrl(keyA, localId)).toBe("");
    await flush();
    expect(runtimeObjectUrl(keyA, localId)).toBe("blob:test/1");
    removeAttachment(keyA, localId);
    expect(queueSnapshot(keyA)?.items).toHaveLength(0);
    expect(runtimeFile(keyA, localId)).toBeNull();
    expect(revoked).toBe(1);
  });

  test("patches status without leaking across panes", () => {
    const [idA] = adoptIncoming(keyA, scopeA, [fakeFile("a", 5)]);
    adoptIncoming(keyB, scopeB, [fakeFile("b", 5)]);
    patchStatus(keyA, idA, "uploading", { acknowledged: 3 });
    expect(queueSnapshot(keyA)?.items[0]).toMatchObject({ status: "uploading", acknowledged: 3 });
    expect(queueSnapshot(keyB)?.items[0].status).toBe("queued");
  });

  test("checkpoint and abort handles stay in the runtime table", () => {
    const [id] = adoptIncoming(keyA, scopeA, [fakeFile("a", 5)]);
    const abort = new AbortController();
    setRuntimeAbort(keyA, id, abort);
    setRuntimeCheckpoint(keyA, id, {
      uploadId: "u1", paneId: "p1", name: "a", size: 5, sha256: "0".repeat(64), mime: "",
    });
    expect(runtimeAbort(keyA, id)).toBe(abort);
    expect(runtimeCheckpoint(keyA, id)?.uploadId).toBe("u1");
    abortAttachment(keyA, id);
    expect(abort.signal.aborted).toBe(true);
  });

  test("edited images replace the File, reset upload identity and regenerate the thumbnail", async () => {
    const [id] = adoptIncoming(keyA, scopeA, [fakeFile("photo.jpg", 500, "image/jpeg")]);
    await flush();
    const oldUrl = runtimeObjectUrl(keyA, id);
    expect(oldUrl).toContain("blob:");
    patchStatus(keyA, id, "uploading", { acknowledged: 100 });
    adoptEditedFile(keyA, id, fakeFile("photo.png", 700, "image/png"), {
      name: "photo.png", size: 700, mime: "image/png",
    });
    const item = queueSnapshot(keyA)?.items[0]!;
    expect(item).toMatchObject({
      name: "photo.png", size: 700, mime: "image/png", status: "queued", acknowledged: 0,
    });
    expect(runtimeFile(keyA, id)?.name).toBe("photo.png");
    expect(runtimeCheckpoint(keyA, id)).toBeNull();
    // Edit immediately reverted to a placeholder and revoked the old thumb.
    expect(runtimeObjectUrl(keyA, id)).toBe("");
    expect(revoked).toBe(1);
    await flush();
    const newUrl = runtimeObjectUrl(keyA, id);
    expect(newUrl).toContain("blob:");
    expect(newUrl).not.toBe(oldUrl);
    expect(revoked).toBe(1); // the new thumbnail is the only live URL
  });

  test("inserted marks and edit notes update the row", () => {
    const [id] = adoptIncoming(keyA, scopeA, [fakeFile("a", 5)]);
    markInserted(keyA, id);
    setItemEditNote(keyA, id, "nope");
    expect(queueSnapshot(keyA)?.items[0]).toMatchObject({ inserted: true, editNote: "nope" });
    setQueueNotice(keyA, "done");
    expect(queueSnapshot(keyA)?.notice).toBe("done");
  });

  test("reset cancels and revokes every runtime across queues", async () => {
    const [a] = adoptIncoming(keyA, scopeA, [fakeFile("a.jpg", 5, "image/jpeg")]);
    const [b] = adoptIncoming(keyB, scopeB, [fakeFile("b.jpg", 5, "image/jpeg")]);
    while (!runtimeObjectUrl(keyA, a) || !runtimeObjectUrl(keyB, b)) await flush();
    const abortA = setRuntimeAbort(keyA, a, new AbortController());
    setRuntimeAbort(keyB, b, new AbortController());
    resetAttachmentQueues();
    expect(abortA?.signal.aborted).toBe(true);
    expect(queueSnapshot(keyA)).toBeUndefined();
    expect(queueSnapshot(keyB)).toBeUndefined();
    expect(revoked).toBe(2);
    dropRuntime(keyA, a);
  });
});

describe("image compression runtime: source, provenance, cache, reset", () => {
  function fakeImage(name: string, size: number, type = "image/jpeg"): File {
    return new File([new Uint8Array(size)], name, { type });
  }

  function checkpoint(localId: string, size: number) {
    return { uploadId: `u_${localId}`, paneId: "p1", name: "photo.jpg", size, sha256: "0".repeat(64), mime: "image/jpeg" };
  }

  test("a new image defaults to smart compression and records original source bytes; non-images do not", () => {
    const [id] = adoptIncoming(keyA, scopeA, [fakeImage("photo.jpg", 1000)]);
    const item = queueSnapshot(keyA)?.items.find((i) => i.localId === id)!;
    expect(item).toMatchObject({ kind: "image", compressionMode: "smart", originalBytes: 1000 });
    const [fid] = adoptIncoming(keyA, scopeA, [fakeFile("doc.pdf", 50, "application/pdf")]);
    const fitem = queueSnapshot(keyA)?.items.find((i) => i.localId === fid)!;
    expect(fitem.compressionMode).toBeUndefined();
    expect(fitem.originalBytes).toBeUndefined();
  });

  test("source and upload file start identical; prepare swaps only the upload file", () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    expect(runtimeSourceFile(keyA, id)).toBe(source);
    expect(runtimeFile(keyA, id)).toBe(source);
    const compressed = fakeImage("photo.jpg", 400);
    const ok = setPreparedImage(keyA, id, { sourceFile: source, file: compressed, reason: "compressed", originalBytes: 1000, changed: true }, 0);
    expect(ok).toBe(true);
    // Source is untouched; only the upload file becomes the compressed result.
    expect(runtimeSourceFile(keyA, id)).toBe(source);
    expect(runtimeFile(keyA, id)).toBe(compressed);
    const item = queueSnapshot(keyA)?.items.find((i) => i.localId === id)!;
    expect(item).toMatchObject({ size: 400, originalBytes: 1000, compressionReason: "compressed", compressionChanged: true, compressing: false });
    // The prepared cache is retained for this source revision.
    expect(runtimePreparedImage(keyA, id)?.file).toBe(compressed);
  });

  test("setPreparedImage preserves a non-aborted abort but refuses a checkpoint or a fired abort", () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    // A non-aborted in-flight abort belongs to this attempt and is preserved;
    // generation is untouched. No checkpoint exists on a fresh preparation.
    const abort = setRuntimeAbort(keyA, id, new AbortController());
    const ok = setPreparedImage(keyA, id, { sourceFile: source, file: fakeImage("photo.jpg", 400), reason: "compressed", originalBytes: 1000, changed: true }, 0);
    expect(ok).toBe(true);
    expect(runtimeAbort(keyA, id)).toBe(abort);
    expect(runtimeGeneration(keyA, id)).toBe(0);
    expect(runtimeFile(keyA, id)?.size).toBe(400);
    // A pending upload identity (checkpoint) can never be replaced.
    const [id2] = adoptIncoming(keyA, scopeA, [fakeImage("two.jpg", 1000)]);
    setRuntimeCheckpoint(keyA, id2, checkpoint(id2, 1000));
    const ok2 = setPreparedImage(keyA, id2, { sourceFile: runtimeSourceFile(keyA, id2)!, file: fakeImage("two.jpg", 400), reason: "compressed", originalBytes: 1000, changed: true }, 0);
    expect(ok2).toBe(false);
    expect(runtimeFile(keyA, id2)).toBe(runtimeSourceFile(keyA, id2));
    expect(runtimePreparedImage(keyA, id2)).toBeNull();
    // A fired abort (cancelled during prepare) is refused — no Begin identity swap.
    const [id3] = adoptIncoming(keyA, scopeA, [fakeImage("three.jpg", 1000)]);
    const abort3 = new AbortController();
    setRuntimeAbort(keyA, id3, abort3);
    abort3.abort();
    const ok3 = setPreparedImage(keyA, id3, { sourceFile: runtimeSourceFile(keyA, id3)!, file: fakeImage("three.jpg", 400), reason: "compressed", originalBytes: 1000, changed: true }, 0);
    expect(ok3).toBe(false);
    expect(runtimeFile(keyA, id3)).toBe(runtimeSourceFile(keyA, id3));
    expect(runtimePreparedImage(keyA, id3)).toBeNull();
  });

  test("setPreparedImage rejects a stale source (an edit moved the source)", () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    const ok = setPreparedImage(keyA, id, { sourceFile: fakeImage("other.jpg", 5), file: fakeImage("other.jpg", 2), reason: "compressed", originalBytes: 5, changed: true }, 0);
    expect(ok).toBe(false);
    expect(runtimeFile(keyA, id)).toBe(source);
    expect(runtimePreparedImage(keyA, id)).toBeNull();
  });

  test("setPreparedImage rejects a stale generation (a newer claim owns the row)", () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    bumpRuntimeGeneration(keyA, id);
    const ok = setPreparedImage(keyA, id, { sourceFile: source, file: fakeImage("photo.jpg", 400), reason: "compressed", originalBytes: 1000, changed: true }, 0);
    expect(ok).toBe(false);
    expect(runtimeFile(keyA, id)).toBe(source);
    expect(runtimePreparedImage(keyA, id)).toBeNull();
  });

  test("photo provenance: JPEG photo, JPEG by extension, screenshot-named JPEG, PNG", () => {
    const [photo] = adoptIncoming(keyA, scopeA, [fakeImage("photo.jpg", 10, "image/jpeg")]);
    expect(runtimePhotoOrigin(keyA, photo)).toBe(true);
    const [byExt] = adoptIncoming(keyA, scopeA, [fakeImage("pic.jpeg", 10, "")]);
    expect(runtimePhotoOrigin(keyA, byExt)).toBe(true);
    const [shot] = adoptIncoming(keyA, scopeA, [fakeImage("Screenshot_2024.jpg", 10, "image/jpeg")]);
    expect(runtimePhotoOrigin(keyA, shot)).toBe(false);
    const [png] = adoptIncoming(keyA, scopeA, [fakeImage("shot.png", 10, "image/png")]);
    expect(runtimePhotoOrigin(keyA, png)).toBe(false);
  });

  test("adoptEditedFile preserves JPEG photo origin and invalidates the prepared cache", () => {
    const [id] = adoptIncoming(keyA, scopeA, [fakeImage("photo.jpg", 1000, "image/jpeg")]);
    expect(runtimePhotoOrigin(keyA, id)).toBe(true);
    const source = runtimeSourceFile(keyA, id)!;
    setPreparedImage(keyA, id, { sourceFile: source, file: fakeImage("photo.jpg", 400), reason: "compressed", originalBytes: 1000, changed: true }, 0);
    expect(runtimePreparedImage(keyA, id)).not.toBeNull();
    // Edit exports a PNG: source+file become the PNG, the cache clears, origin stays.
    adoptEditedFile(keyA, id, fakeImage("photo.png", 700, "image/png"), { name: "photo.png", size: 700, mime: "image/png" });
    expect(runtimePhotoOrigin(keyA, id)).toBe(true);
    expect(runtimeSourceFile(keyA, id)?.name).toBe("photo.png");
    expect(runtimePreparedImage(keyA, id)).toBeNull();
    const item = queueSnapshot(keyA)?.items.find((i) => i.localId === id)!;
    expect(item).toMatchObject({ size: 700, originalBytes: 700, compressionChanged: false, compressing: false });
    expect(item.compressionMode).toBe("smart");
  });

  test("setPreference resets the upload file to the source on a safely idle row", () => {
    const source = fakeImage("photo.jpg", 1000, "image/jpeg");
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    const compressed = fakeImage("photo.jpg", 400);
    setPreparedImage(keyA, id, { sourceFile: source, file: compressed, reason: "compressed", originalBytes: 1000, changed: true }, 0);
    expect(runtimeFile(keyA, id)).toBe(compressed);
    expect(setPreference(keyA, id, "original")).toBe(true);
    expect(runtimeFile(keyA, id)).toBe(source);
    const item = queueSnapshot(keyA)?.items.find((i) => i.localId === id)!;
    expect(item).toMatchObject({ compressionMode: "original", size: 1000, originalBytes: 1000, compressionChanged: false });
    // The prepared cache survives a preference change (it is per source revision).
    expect(runtimePreparedImage(keyA, id)?.file).toBe(compressed);
  });

  test("setPreference refuses an active row, an unresolved handle, and a cancel intent", () => {
    const [id] = adoptIncoming(keyA, scopeA, [fakeImage("photo.jpg", 1000)]);
    patchStatus(keyA, id, "uploading");
    expect(setPreference(keyA, id, "original")).toBe(false);
    patchStatus(keyA, id, "queued");
    setRuntimeCheckpoint(keyA, id, checkpoint(id, 1000));
    expect(setPreference(keyA, id, "original")).toBe(false);
    clearRuntimeCheckpoint(keyA, id);
    patchItem(keyA, id, { cancelIntent: true });
    expect(setPreference(keyA, id, "original")).toBe(false);
    patchItem(keyA, id, { cancelIntent: false });
    expect(setPreference(keyA, id, "original")).toBe(true);
  });

  test("dropRuntime revokes the thumbnail URL and releases the prepared cache", async () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    await flush();
    expect(runtimeObjectUrl(keyA, id)).toContain("blob:");
    setPreparedImage(keyA, id, { sourceFile: source, file: fakeImage("photo.jpg", 400), reason: "compressed", originalBytes: 1000, changed: true }, 0);
    dropRuntime(keyA, id);
    expect(revoked).toBe(1);
    expect(runtimeSourceFile(keyA, id)).toBeNull();
    expect(runtimePreparedImage(keyA, id)).toBeNull();
  });

  test("resetAttachmentQueues drops every compression runtime across panes", () => {
    const [a] = adoptIncoming(keyA, scopeA, [fakeImage("a.jpg", 10)]);
    adoptIncoming(keyB, scopeB, [fakeImage("b.jpg", 10)]);
    resetAttachmentQueues();
    expect(runtimeSourceFile(keyA, a)).toBeNull();
    expect(runtimePreparedImage(keyA, a)).toBeNull();
    expect(queueSnapshot(keyA)).toBeUndefined();
    expect(queueSnapshot(keyB)).toBeUndefined();
  });
});

describe("image rendering intent setter", () => {
  function fakeImage(name: string, size: number, type = "image/jpeg"): File {
    return new File([new Uint8Array(size)], name, { type });
  }

  function checkpoint(localId: string, size: number) {
    return {
      uploadId: "u1", paneId: scopeA.paneId, name: `${localId}.png`, size,
      sha256: "a".repeat(64), mime: "image/png",
    };
  }

  test("sets the intent, resets the upload file to the source and invalidates the prepared cache", () => {
    const source = fakeImage("shot.png", 1000, "image/png");
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    const compressed = fakeImage("shot.png", 400);
    setPreparedImage(keyA, id, { sourceFile: source, file: compressed, reason: "compressed", originalBytes: 1000, changed: true }, 0);
    expect(runtimeFile(keyA, id)).toBe(compressed);
    expect(setImageIntent(keyA, id, "detail")).toBe(true);
    // A cached photo result must never serve a detail row.
    expect(runtimePreparedImage(keyA, id)).toBeNull();
    expect(runtimeFile(keyA, id)).toBe(source);
    const item = queueSnapshot(keyA)?.items.find((i) => i.localId === id)!;
    expect(item).toMatchObject({
      imageIntent: "detail", size: 1000, originalBytes: 1000,
      compressionChanged: false, outputWidth: undefined, outputHeight: undefined,
    });
  });

  test("refuses an active row, a scheduled row, an unresolved checkpoint and a cancel intent", () => {
    const [id] = adoptIncoming(keyA, scopeA, [fakeImage("shot.png", 1000)]);
    patchStatus(keyA, id, "uploading");
    expect(setImageIntent(keyA, id, "detail")).toBe(false);
    patchStatus(keyA, id, "queued");
    patchItem(keyA, id, { scheduled: true });
    expect(setImageIntent(keyA, id, "detail")).toBe(false);
    patchItem(keyA, id, { scheduled: false });
    setRuntimeCheckpoint(keyA, id, checkpoint(id, 1000));
    expect(setImageIntent(keyA, id, "detail")).toBe(false);
    clearRuntimeCheckpoint(keyA, id);
    patchItem(keyA, id, { cancelIntent: true });
    expect(setImageIntent(keyA, id, "detail")).toBe(false);
    patchItem(keyA, id, { cancelIntent: false });
    expect(setImageIntent(keyA, id, "detail")).toBe(true);
  });

  test("a fresh prepare after a detail switch propagates real output dimensions", () => {
    const source = fakeImage("shot.png", 1000, "image/png");
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    expect(setImageIntent(keyA, id, "detail")).toBe(true);
    expect(setPreparedImage(keyA, id, {
      sourceFile: source, file: source, reason: "preserved",
      originalBytes: 1000, changed: false, width: 1280, height: 720,
    }, runtimeGeneration(keyA, id))).toBe(true);
    const item = queueSnapshot(keyA)?.items.find((i) => i.localId === id)!;
    expect(item.outputWidth).toBe(1280);
    expect(item.outputHeight).toBe(720);
  });
});

type ThumbGate = {
  promise: Promise<Blob | null>;
  resolve: (blob: Blob | null) => void;
  reject: (error: unknown) => void;
};

function thumbGate(): ThumbGate {
  let resolve!: (blob: Blob | null) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Blob | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type GatedThumbCall = { file: File; gate: ThumbGate };

/** Preparer whose every invocation parks on a test-controlled gate. */
function installGatedPreparer(): GatedThumbCall[] {
  const calls: GatedThumbCall[] = [];
  setThumbnailPreparer((file, options) => {
    const gate = thumbGate();
    options?.signal?.addEventListener(
      "abort",
      () => gate.reject(new DOMException("aborted", "AbortError")),
      { once: true },
    );
    calls.push({ file, gate });
    return gate.promise;
  });
  return calls;
}

function smallThumb(type: string): Blob {
  return new Blob([new Uint8Array([0x01, 0x02, 0x03, 0x04])], { type });
}

describe("thumbnail-only object URL lifecycle", () => {
  test("renders a placeholder first and creates an object URL only for the produced thumbnail Blob", async () => {
    const source = fakeFile("photo.jpg", 1000, "image/jpeg");
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    expect(runtimeObjectUrl(keyA, id)).toBe("");
    expect(issued).toBe(0); // no URL for the picked source
    await flush();
    expect(runtimeObjectUrl(keyA, id)).toBe("blob:test/1");
    expect(createdFrom).toHaveLength(1);
    expect(createdFrom[0]).toBeInstanceOf(Blob);
    expect(createdFrom[0]).not.toBeInstanceOf(File);
    expect(createdFrom[0]).not.toBe(source);
  });

  test("prepare/preference/intent/upload-generation changes preserve the valid same-source thumbnail and never URL a File", async () => {
    const source = fakeFile("photo.jpg", 1000, "image/jpeg");
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    await flush();
    const url = runtimeObjectUrl(keyA, id);
    const compressed = fakeFile("photo.jpg", 400, "image/jpeg");
    setPreparedImage(keyA, id, {
      sourceFile: source, file: compressed, reason: "compressed",
      originalBytes: 1000, changed: true,
    }, 0);
    expect(runtimeObjectUrl(keyA, id)).toBe(url); // compression keeps the source preview
    expect(setPreference(keyA, id, "original")).toBe(true);
    expect(runtimeObjectUrl(keyA, id)).toBe(url);
    expect(setPreference(keyA, id, "smart")).toBe(true);
    expect(runtimeObjectUrl(keyA, id)).toBe(url);
    expect(setImageIntent(keyA, id, "detail")).toBe(true);
    expect(runtimeObjectUrl(keyA, id)).toBe(url);
    expect(setImageIntent(keyA, id, "photo")).toBe(true);
    expect(runtimeObjectUrl(keyA, id)).toBe(url);
    bumpRuntimeGeneration(keyA, id);
    bumpRuntimeGeneration(keyA, id); // upload claims never dispose a valid thumbnail
    expect(runtimeObjectUrl(keyA, id)).toBe(url);
    expect(revoked).toBe(0);
    // Every created URL backs a small thumbnail Blob — never source/upload File.
    for (const blob of createdFrom) {
      expect(blob).not.toBeInstanceOf(File);
      expect(blob).not.toBe(source);
      expect(blob).not.toBe(compressed);
    }
  });

  test("an edit aborts the queued/old thumbnail; its late result cannot install, and the new revision installs", async () => {
    const calls = installGatedPreparer();
    const [id] = adoptIncoming(keyA, scopeA, [fakeFile("photo.jpg", 1000, "image/jpeg")]);
    await flush();
    expect(calls).toHaveLength(1); // first revision is the single active producer
    adoptEditedFile(keyA, id, fakeFile("photo.png", 700, "image/png"), {
      name: "photo.png", size: 700, mime: "image/png",
    });
    expect(runtimeObjectUrl(keyA, id)).toBe(""); // placeholder again immediately
    // A late SUCCESS from the old, aborted core revision (core would normally
    // reject; guard must not depend on that):
    calls[0].gate.resolve(smallThumb("image/jpeg"));
    await flush();
    expect(runtimeObjectUrl(keyA, id)).toBe(""); // stale answer discarded
    expect(issued).toBe(0);
    expect(calls).toHaveLength(2); // the queue advanced to the new revision
    calls[1].gate.resolve(smallThumb("image/png"));
    await flush();
    expect(runtimeObjectUrl(keyA, id)).toContain("blob:");
    expect(issued).toBe(1); // only the new revision ever held a URL
    expect(revoked).toBe(0); // no old URL existed to revoke, and the new one is live
    expect(createdFrom).toHaveLength(1);
    expect(createdFrom[0].type).toBe("image/png");
  });

  test("remove during production drops the late answer without touching another row's URL", async () => {
    const calls = installGatedPreparer();
    const [a, b] = adoptIncoming(keyA, scopeA, [
      fakeFile("a.jpg", 100, "image/jpeg"),
      fakeFile("b.jpg", 200, "image/jpeg"),
    ]);
    await flush();
    expect(calls).toHaveLength(1); // a active, b queued
    removeAttachment(keyA, a);
    calls[0].gate.resolve(smallThumb("image/jpeg")); // late answer for the removed row
    await flush();
    expect(calls).toHaveLength(2); // b still drains
    calls[1].gate.resolve(smallThumb("image/jpeg"));
    await flush();
    const bUrl = runtimeObjectUrl(keyA, b);
    expect(bUrl).toContain("blob:");
    expect(revoked).toBe(0); // the late answer never installed/revoked anything
    expect(createdFrom).toHaveLength(1);
    expect(runtimeFile(keyA, a)).toBeNull();
  });

  test("a reset during production discards the late result and never installs a URL", async () => {
    const calls = installGatedPreparer();
    adoptIncoming(keyA, scopeA, [fakeFile("a.jpg", 100, "image/jpeg")]);
    await flush();
    expect(calls).toHaveLength(1);
    resetAttachmentQueues();
    calls[0].gate.resolve(smallThumb("image/jpeg"));
    await flush();
    expect(queueSnapshot(keyA)).toBeUndefined();
    expect(issued).toBe(0);
  });

  test("a late answer cannot publish onto a re-adopted entry with the same id/source/generation", async () => {
    const calls = installGatedPreparer();
    const source = fakeFile("photo.jpg", 1000, "image/jpeg");
    const [id] = adoptIncoming(keyA, scopeA, [source]);
    await flush();
    expect(calls).toHaveLength(1);
    dropRuntime(keyA, id); // old captured entry is deleted and aborted
    adoptRuntime(keyA, id, scopeA, source); // fresh entry: same id, source, generation 0
    calls[0].gate.resolve(smallThumb("image/jpeg"));
    await flush();
    expect(runtimeObjectUrl(keyA, id)).toBe(""); // object identity guard rejected it
    expect(issued).toBe(0);
  });

  test("a failed/non-image thumbnail keeps the empty placeholder, never a source URL", async () => {
    setThumbnailPreparer(async () => null);
    const [id] = adoptIncoming(keyA, scopeA, [fakeFile("broken.jpg", 1000, "image/jpeg")]);
    await flush();
    expect(runtimeObjectUrl(keyA, id)).toBe("");
    expect(issued).toBe(0);
    expect(queueSnapshot(keyA)?.items[0].kind).toBe("image");
  });

  test("non-image rows never enter the thumbnail producer", async () => {
    const seen: File[] = [];
    setThumbnailPreparer((file, options) => {
      seen.push(file);
      return abortAwareThumbnail(file, options);
    });
    adoptIncoming(keyA, scopeA, [
      fakeFile("photo.jpg", 10, "image/jpeg"),
      fakeFile("notes.txt", 20, "text/plain"),
    ]);
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe("photo.jpg");
  });

  test("multiple adopted images reach the producer one at a time, in order", async () => {
    const calls = installGatedPreparer();
    adoptIncoming(keyA, scopeA, [
      fakeFile("one.jpg", 10), fakeFile("two.jpg", 20), fakeFile("three.jpg", 30),
    ].map((f) => new File([new Uint8Array(f.size)], f.name, { type: "image/jpeg" })));
    await flush();
    expect(calls.map((c) => c.file.name)).toEqual(["one.jpg"]);
    calls[0].gate.resolve(smallThumb("image/jpeg"));
    await flush();
    expect(calls.map((c) => c.file.name)).toEqual(["one.jpg", "two.jpg"]);
    calls[1].gate.resolve(smallThumb("image/jpeg"));
    await flush();
    expect(calls.map((c) => c.file.name)).toEqual(["one.jpg", "two.jpg", "three.jpg"]);
    calls[2].gate.resolve(smallThumb("image/jpeg"));
    await flush();
    expect(issued).toBe(3);
  });
});

let restoreSeq = 0;

function journalRecord(input: {
  source: File;
  upload?: File;
  localId?: string;
  item?: Partial<AttachmentItem>;
  checkpoint?: AttachmentCheckpoint;
  daemonId?: string;
  paneId?: string;
}): AttachmentJournalRecord {
  const source = input.source;
  const upload = input.upload ?? source;
  const localId = input.localId ?? `att_restore_${++restoreSeq}`;
  const item: AttachmentItem = {
    localId,
    kind: source.type.startsWith("image/") ? "image" : "file",
    name: upload.name,
    size: upload.size,
    mime: upload.type ?? "",
    status: "queued",
    acknowledged: 0,
    errorText: "",
    recoverable: false,
    path: "",
    inserted: false,
    editNote: "",
    cancelIntent: false,
    ...input.item,
  };
  const record: AttachmentJournalRecord = {
    version: 1,
    daemonId: input.daemonId ?? "d1",
    paneId: input.paneId ?? "p1",
    localId,
    updatedAt: Date.now(),
    sourceFile: source,
    uploadFile: upload,
    item,
  };
  if (input.checkpoint) record.checkpoint = input.checkpoint;
  return record;
}

describe("restoreAttachmentRecord", () => {
  test("restores exact source/upload and intent for a queued row without scheduling anything", async () => {
    const source = fakeFile("photo.jpg", 1000, "image/jpeg");
    const upload = fakeFile("photo.jpg", 400, "image/jpeg");
    const record = journalRecord({
      source, upload,
      item: {
        status: "uploading", acknowledged: 250, recoverable: true,
        compressionMode: "smart", imageIntent: "detail", originalBytes: 1000,
        scheduled: true, transferPhase: "sending", compressing: true,
        speedBps: 999, etaSeconds: 5, waiting: true, stageTimings: { sending: 12 },
      },
    });
    expect(restoreAttachmentRecord(record)).toBe(true);
    const id = record.localId;
    expect(runtimeSourceFile(keyA, id)).toBe(source); // exact saved File objects
    expect(runtimeFile(keyA, id)).toBe(upload);
    expect(runtimeCheckpoint(keyA, id)).toBeNull();
    expect(runtimePreparedImage(keyA, id)).toBeNull();
    expect(runtimeGeneration(keyA, id)).toBe(0); // nothing claimed
    expect(runtimeAbort(keyA, id)).toBeNull(); // nothing scheduled
    const item = queueSnapshot(keyA)?.items.find((row) => row.localId === id)!;
    expect(item).toMatchObject({
      status: "queued", recoverable: false, acknowledged: 0,
      imageIntent: "detail", compressionMode: "smart", restored: true,
    });
    expect(item.scheduled).toBe(false);
    expect(item.compressing).toBe(false);
    expect(item.transferPhase).toBeUndefined();
    expect(item.speedBps).toBeUndefined();
    expect(item.etaSeconds).toBeUndefined();
    expect(item.waiting).toBeUndefined();
    expect(item.stageTimings).toBeUndefined();
    await flush(); // and nothing auto-starts: still queued
    expect(queueSnapshot(keyA)?.items.find((row) => row.localId === id)?.status).toBe("queued");
    expect(runtimeGeneration(keyA, id)).toBe(0);
    expect(createdFrom).toHaveLength(1); // its thumbnail renders from the SOURCE
  });

  test("a checkpoint restores to error/recoverable with the exact checkpoint and cancelIntent preserved", async () => {
    const source = fakeFile("photo.jpg", 1000, "image/jpeg");
    const upload = fakeFile("photo.jpg", 400, "image/jpeg");
    const checkpoint: AttachmentCheckpoint = {
      uploadId: "u-restore", paneId: "p1", name: "photo.jpg", size: 400,
      sha256: "a".repeat(64), mime: "image/jpeg", version: 2,
    };
    const record = journalRecord({
      source, upload, checkpoint,
      item: {
        status: "cancelling", acknowledged: 300, cancelIntent: true,
        transferPhase: "commit", scheduled: true,
      },
    });
    expect(restoreAttachmentRecord(record)).toBe(true);
    const id = record.localId;
    expect(runtimeCheckpoint(keyA, id)).toBe(checkpoint); // exact object retained
    expect(runtimeAbort(keyA, id)).toBeNull();
    expect(runtimeGeneration(keyA, id)).toBe(0);
    const item = queueSnapshot(keyA)?.items.find((row) => row.localId === id)!;
    expect(item).toMatchObject({
      status: "error", recoverable: true, cancelIntent: true,
      scheduled: false, transferPhase: undefined, acknowledged: 0, restored: true,
    });
  });

  test("committed and cancelled journal records are ignored", () => {
    const source = fakeFile("done.jpg", 100, "image/jpeg");
    const committed = journalRecord({
      source,
      item: { status: "committed", acknowledged: 100, path: "/tmp/done.jpg" },
    });
    expect(restoreAttachmentRecord(committed)).toBe(false);
    const cancelled = journalRecord({
      source,
      item: { status: "cancelled" },
    });
    expect(restoreAttachmentRecord(cancelled)).toBe(false);
    expect(queueSnapshot(keyA)?.items ?? []).toEqual([]);
  });

  test("an existing row or runtime with the same local id is never overwritten", () => {
    const record = journalRecord({ source: fakeFile("photo.jpg", 1000, "image/jpeg") });
    expect(restoreAttachmentRecord(record)).toBe(true);
    // Second restore of the same journal record collides on runtime AND row.
    expect(restoreAttachmentRecord(record)).toBe(false);
    expect(queueSnapshot(keyA)?.items.filter((row) => row.localId === record.localId)).toHaveLength(1);
  });

  test("identity and upload-metadata mismatches are refused", () => {
    const source = fakeFile("photo.jpg", 1000, "image/jpeg");
    const wrongLocal = journalRecord({ source, localId: "att_x", item: { localId: "att_other" } });
    expect(restoreAttachmentRecord(wrongLocal)).toBe(false);
    const upload = fakeFile("photo.jpg", 400, "image/jpeg");
    const wrongMeta = journalRecord({
      source, upload,
      item: { name: "different.jpg", size: 999, mime: "image/png" },
    });
    expect(restoreAttachmentRecord(wrongMeta)).toBe(false);
    expect(queueSnapshot(keyA)?.items ?? []).toEqual([]);
  });

  test("photo provenance is derived from the source, never from a compressed upload", async () => {
    // JPEG source (a real photo) with a PNG-named upload File.
    const record = journalRecord({
      source: fakeFile("photo.jpg", 1000, "image/jpeg"),
      upload: fakeFile("edited.png", 800, "image/png"),
    });
    expect(restoreAttachmentRecord(record)).toBe(true);
    expect(runtimePhotoOrigin(keyA, record.localId)).toBe(true);
    const screenshot = journalRecord({
      source: fakeFile("Screenshot_1.jpg", 1000, "image/jpeg"),
    });
    expect(restoreAttachmentRecord(screenshot)).toBe(true);
    expect(runtimePhotoOrigin(keyA, screenshot.localId)).toBe(false);
  });

  test("a restored non-image row gets no thumbnail and keeps the exact file", async () => {
    const seen: File[] = [];
    setThumbnailPreparer((file, options) => {
      seen.push(file);
      return abortAwareThumbnail(file, options);
    });
    const doc = new File([new Uint8Array(50)], "doc.pdf", { type: "application/pdf" });
    const record = journalRecord({ source: doc });
    expect(restoreAttachmentRecord(record)).toBe(true);
    const id = record.localId;
    expect(queueSnapshot(keyA)?.items[0]).toMatchObject({ kind: "file", status: "queued", restored: true });
    expect(runtimeSourceFile(keyA, id)).toBe(doc);
    expect(runtimeFile(keyA, id)).toBe(doc);
    await flush();
    expect(seen).toHaveLength(0);
    expect(runtimeObjectUrl(keyA, id)).toBe("");
  });

  test("a restored row never uploads or schedules by itself", async () => {
    const record = journalRecord({
      source: fakeFile("photo.jpg", 1000, "image/jpeg"),
      item: { status: "preparing", compressing: true },
    });
    expect(restoreAttachmentRecord(record)).toBe(true);
    await flush();
    const item = queueSnapshot(keyA)?.items[0]!;
    expect(item.status).toBe("queued");
    expect(item.scheduled ?? false).toBe(false);
    expect(item.compressing).toBe(false);
    expect(runtimeAbort(keyA, record.localId)).toBeNull();
    expect(runtimeGeneration(keyA, record.localId)).toBe(0);
  });
});
