import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  adoptEditedFile,
  adoptIncoming,
  attachmentScopeKey,
  bumpRuntimeGeneration,
  patchItem,
  queueSnapshot,
  resetAttachmentQueues,
  runtimeFile,
  runtimeGeneration,
  runtimePreparedImage,
  runtimeSourceFile,
  setPreference,
} from "./attachments-store";
import { prepareFreshImage, setImagePreparer } from "./attachments-image";
import type { AttachmentScope } from "./attachments-store";
import type { AttachmentImageResult } from "./attachments-image";

const scope: AttachmentScope = { daemonId: "d1", paneId: "p1" };
const key = attachmentScopeKey(scope);

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

function fakeImage(name: string, size: number, type = "image/jpeg"): File {
  return new File([new Uint8Array(size)], name, { type });
}
function item(localId: string) {
  return queueSnapshot(key)!.items.find((i) => i.localId === localId)!;
}
function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  URL.createObjectURL = () => "blob:test/x";
  URL.revokeObjectURL = () => {};
  resetAttachmentQueues();
});

afterEach(() => {
  setImagePreparer(null);
  resetAttachmentQueues();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe("fresh-upload image preparation", () => {
  test("smart image prepares the source, installs the result, caches it and clears compressing", async () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(key, scope, [source]);
    const compressed = fakeImage("photo.jpg", 400);
    setImagePreparer(async (file) => ({
      file: compressed, changed: true, originalBytes: file.size, reason: "compressed",
    }));
    const result = await prepareFreshImage(scope, id, 0, new AbortController().signal, () => true);
    expect(result).toBe(compressed);
    expect(runtimeFile(key, id)).toBe(compressed);
    expect(runtimeSourceFile(key, id)).toBe(source); // source preserved for re-edit
    expect(item(id)).toMatchObject({
      size: 400, originalBytes: 1000, compressionReason: "compressed",
      compressionChanged: true, compressing: false,
    });
    expect(runtimePreparedImage(key, id)?.file).toBe(compressed);
  });

  test("original mode and non-image rows return the exact source without calling the preparer", async () => {
    let calls = 0;
    setImagePreparer(async (file) => { calls += 1; return { file, changed: false, originalBytes: file.size, reason: "failed" }; });
    const photo = fakeImage("photo.jpg", 1000);
    const [pid] = adoptIncoming(key, scope, [photo]);
    setPreference(key, pid, "original");
    expect(await prepareFreshImage(scope, pid, 0, new AbortController().signal, () => true)).toBe(photo);
    const [docId] = adoptIncoming(key, scope, [new File([new Uint8Array(50)], "doc.pdf", { type: "application/pdf" })]);
    expect(await prepareFreshImage(scope, docId, 0, new AbortController().signal, () => true)).toBe(runtimeSourceFile(key, docId));
    expect(calls).toBe(0); // never decoded
  });

  test("a cached result for the same source revision is reused without re-decoding", async () => {
    let calls = 0;
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(key, scope, [source]);
    const compressed = fakeImage("photo.jpg", 400);
    setImagePreparer(async () => { calls += 1; return { file: compressed, changed: true, originalBytes: 1000, reason: "compressed" }; });
    expect(await prepareFreshImage(scope, id, 0, new AbortController().signal, () => true)).toBe(compressed);
    // Second call for the same revision: cache hit, preparer not invoked again.
    expect(await prepareFreshImage(scope, id, 0, new AbortController().signal, () => true)).toBe(compressed);
    expect(calls).toBe(1);
  });

  test("core fallback (unchanged source) installs the original, caches it and reports no change", async () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(key, scope, [source]);
    setImagePreparer(async (file) => ({ file, changed: false, originalBytes: file.size, reason: "failed" }));
    const result = await prepareFreshImage(scope, id, 0, new AbortController().signal, () => true);
    expect(result).toBe(source);
    expect(item(id)).toMatchObject({ compressionReason: "failed", compressionChanged: false, size: 1000 });
    expect(runtimePreparedImage(key, id)?.file).toBe(source);
  });

  test("cancel during prepare aborts the codec and installs nothing", async () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(key, scope, [source]);
    const ac = new AbortController();
    let preparerCalled = false;
    setImagePreparer((_file, opts) => {
      preparerCalled = true;
      // Mirror the real codec: reject when the abort signal fires.
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const p = prepareFreshImage(scope, id, 0, ac.signal, () => true);
    expect(item(id).compressing).toBe(true); // set synchronously before the first await
    // Let the preparation reach the codec (preparer call) before cancelling.
    await Promise.resolve();
    expect(preparerCalled).toBe(true);
    ac.abort(); // codec rejects on abort; catch settles without Begin
    expect(await p).toBeNull();
    expect(runtimeFile(key, id)).toBe(source); // upload file untouched
    expect(item(id).compressing).toBe(false);
    expect(runtimePreparedImage(key, id)).toBeNull();
  });

  test("a scope/session move during prepare installs nothing and clears compressing", async () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(key, scope, [source]);
    const { promise, resolve } = deferred<AttachmentImageResult>();
    setImagePreparer(() => promise);
    let live = true;
    const p = prepareFreshImage(scope, id, 0, new AbortController().signal, () => live);
    live = false; // owner scope/session gone while the codec ran
    resolve({ file: fakeImage("photo.jpg", 400), changed: true, originalBytes: 1000, reason: "compressed" });
    expect(await p).toBeNull();
    expect(runtimeFile(key, id)).toBe(source);
    expect(item(id).compressing).toBe(false);
    expect(runtimePreparedImage(key, id)).toBeNull();
  });

  test("a newer claim (stale generation) during prepare installs nothing", async () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(key, scope, [source]);
    const { promise, resolve } = deferred<AttachmentImageResult>();
    setImagePreparer(() => promise);
    const p = prepareFreshImage(scope, id, 0, new AbortController().signal, () => true);
    bumpRuntimeGeneration(key, id); // a newer upload/cancel claim superseded this row
    resolve({ file: fakeImage("photo.jpg", 400), changed: true, originalBytes: 1000, reason: "compressed" });
    expect(await p).toBeNull();
    expect(runtimeFile(key, id)).toBe(source); // newer owner owns its own upload file
    expect(runtimePreparedImage(key, id)).toBeNull();
  });

  test("an edit during prepare moves the source; no stale result installs", async () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(key, scope, [source]);
    const { promise, resolve } = deferred<AttachmentImageResult>();
    setImagePreparer(() => promise);
    const p = prepareFreshImage(scope, id, 0, new AbortController().signal, () => true);
    const edited = fakeImage("photo.png", 700, "image/png");
    adoptEditedFile(key, id, edited, { name: "photo.png", size: 700, mime: "image/png" });
    // Result prepared from the OLD source must not install onto the edited row.
    resolve({ file: fakeImage("photo.jpg", 400), changed: true, originalBytes: 1000, reason: "compressed" });
    expect(await p).toBeNull();
    expect(runtimeFile(key, id)).toBe(edited);
    expect(runtimeSourceFile(key, id)).toBe(edited);
    expect(runtimePreparedImage(key, id)).toBeNull();
  });

  test("respects the trusted photo origin handed to the preparer", async () => {
    const source = fakeImage("photo.jpg", 1000);
    const [id] = adoptIncoming(key, scope, [source]);
    let received: boolean | undefined;
    setImagePreparer(async (_file, opts) => {
      received = opts?.photo;
      return { file: fakeImage("photo.jpg", 400), changed: true, originalBytes: 1000, reason: "compressed" };
    });
    await prepareFreshImage(scope, id, 0, new AbortController().signal, () => true);
    expect(received).toBe(true); // JPEG non-screenshot → photo origin
    const [shot] = adoptIncoming(key, scope, [fakeImage("Screenshot.jpg", 1000)]);
    // Screenshots default to the original; ask for compression explicitly.
    expect(queueSnapshot(key)!.items.find((item) => item.localId === shot)!.compressionMode).toBe("original");
    setPreference(key, shot, "smart");
    await prepareFreshImage(scope, shot, 0, new AbortController().signal, () => true);
    // screenshot-named JPEG is not a photo origin
    expect(received).toBe(false);
  });
});
