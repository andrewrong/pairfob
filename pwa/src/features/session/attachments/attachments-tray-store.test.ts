import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  adoptIncoming,
  attachmentScopeKey,
  defaultCompressionMode,
  moveAttachment,
  patchItem,
  queueSnapshot,
  reissueAttachment,
  resetAttachmentQueues,
  runtimeObjectUrl,
  runtimePhotoOrigin,
  runtimeSourceFile,
  setRuntimeCheckpoint,
  setUploadQuality,
} from "./attachments-store";
import { setThumbnailPreparer } from "./attachments-thumbnails";

const scope = { daemonId: "d1", paneId: "p1" };
const key = attachmentScopeKey(scope);
const ids = () => queueSnapshot(key)!.items.map((item) => item.name);
const row = (id: string) => queueSnapshot(key)!.items.find((item) => item.localId === id)!;
const file = (name: string, type = "") => new File([new Uint8Array(8)], name, { type });

beforeEach(() => {
  resetAttachmentQueues();
  setThumbnailPreparer(async () => null);
});

afterEach(() => {
  resetAttachmentQueues();
  setThumbnailPreparer(null);
});

describe("default image quality by type", () => {
  test("photos compress, screenshots and other images keep their bytes", () => {
    expect(defaultCompressionMode({ name: "IMG_1.jpg", size: 1, mime: "image/jpeg" })).toBe("smart");
    expect(defaultCompressionMode({ name: "IMG_2.HEIC", size: 1, mime: "" })).toBe("smart");
    expect(defaultCompressionMode({ name: "x", size: 1, mime: "image/heif" })).toBe("smart");
    expect(defaultCompressionMode({ name: "shot.png", size: 1, mime: "image/png" })).toBe("original");
    expect(defaultCompressionMode({ name: "Screenshot 1.jpg", size: 1, mime: "image/jpeg" })).toBe("original");
    const [png, jpg] = adoptIncoming(key, scope, [file("a.png", "image/png"), file("b.jpg", "image/jpeg")]);
    expect(row(png).compressionMode).toBe("original");
    expect(row(jpg).compressionMode).toBe("smart");
  });
});

describe("tray order", () => {
  test("moveAttachment reorders the queue (paths follow this order)", () => {
    const [a] = adoptIncoming(key, scope, [file("a"), file("b"), file("c")]);
    moveAttachment(key, a, 2);
    expect(ids()).toEqual(["b", "c", "a"]);
    moveAttachment(key, a, 0);
    expect(ids()).toEqual(["a", "b", "c"]);
    moveAttachment(key, a, 99);
    expect(ids()).toEqual(["b", "c", "a"]);
  });
});

describe("reissue a finished row", () => {
  test("committed row becomes a fresh queued source under a new id, same slot and source", () => {
    const source = file("photo.jpg", "image/jpeg");
    const [a, b] = adoptIncoming(key, scope, [source, file("b.txt")]);
    patchItem(key, a, { status: "committed", path: "/w/photo.jpg", acknowledged: 8, inserted: true, stageTimings: { sending: 3 } });
    const fresh = reissueAttachment(key, a)!;
    expect(fresh).not.toBe(a);
    expect(queueSnapshot(key)!.items.map((item) => item.localId)).toEqual([fresh, b]);
    expect(row(fresh)).toMatchObject({ status: "queued", path: "", acknowledged: 0, inserted: false, stageTimings: undefined });
    expect(runtimeSourceFile(key, fresh)).toBe(source);
    expect(runtimePhotoOrigin(key, fresh)).toBe(true);
    expect(runtimeSourceFile(key, a)).toBeNull();
  });

  test("only committed or cancelled rows without a remote handle", () => {
    const [a, b] = adoptIncoming(key, scope, [file("a"), file("b")]);
    expect(reissueAttachment(key, a)).toBeNull(); // queued
    patchItem(key, b, { status: "cancelled" });
    setRuntimeCheckpoint(key, b, { uploadId: "u", paneId: "p1", name: "b", size: 8, sha256: "a".repeat(64), mime: "" });
    expect(reissueAttachment(key, b)).toBeNull();
  });

  test("a finished thumbnail travels with the row", async () => {
    const original = URL.createObjectURL;
    URL.createObjectURL = () => "blob:thumb";
    setThumbnailPreparer(async () => new Blob([new Uint8Array([1])], { type: "image/jpeg" }));
    try {
      const [a] = adoptIncoming(key, scope, [file("p.jpg", "image/jpeg")]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(runtimeObjectUrl(key, a)).toBe("blob:thumb");
      patchItem(key, a, { status: "committed", path: "/w/p.jpg" });
      const fresh = reissueAttachment(key, a)!;
      expect(runtimeObjectUrl(key, fresh)).toBe("blob:thumb");
    } finally {
      URL.createObjectURL = original;
    }
  });
});

describe("upload quality", () => {
  test("switches mode and settles the retired detail intent on photo", () => {
    const [a] = adoptIncoming(key, scope, [file("p.jpg", "image/jpeg")]);
    patchItem(key, a, { imageIntent: "detail" });
    expect(setUploadQuality(key, a, "original")).toBe(true);
    expect(row(a)).toMatchObject({ compressionMode: "original", imageIntent: "photo" });
    expect(setUploadQuality(key, a, "smart")).toBe(true);
    expect(row(a).compressionMode).toBe("smart");
  });

  test("refuses a running row and non-images", () => {
    const [a, b] = adoptIncoming(key, scope, [file("p.jpg", "image/jpeg"), file("n.txt")]);
    patchItem(key, a, { status: "uploading" });
    expect(setUploadQuality(key, a, "original")).toBe(false);
    expect(setUploadQuality(key, b, "original")).toBe(false);
  });
});
