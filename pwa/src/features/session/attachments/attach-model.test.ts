import { describe, expect, test } from "bun:test";
import {
  canInsert,
  committedUpload,
  editedImageRejection,
  etaParts,
  insertPathsAt,
  insertionTextFits,
  foldUploadingState,
  formatBytes,
  insertionFits,
  isImageMeta,
  measureUploadRate,
  reviewIncoming,
  safeCommittedPath,
  speedParts,
  uploadErrorPatch,
  FALLBACK_ATTACHMENT_LIMITS,
  type AttachmentItem,
  type UploadStateLike,
} from "./attach-model";
import { ProtocolError } from "../../../lib/protocol/errors";

const limits = FALLBACK_ATTACHMENT_LIMITS;

function item(partial: Partial<AttachmentItem> = {}): AttachmentItem {
  return {
    localId: "att_1",
    kind: "file",
    name: "a.txt",
    size: 10,
    mime: "text/plain",
    status: "queued",
    acknowledged: 0,
    errorText: "",
    recoverable: false,
    path: "",
    inserted: false,
    editNote: "",
    cancelIntent: false,
    ...partial,
  };
}

function meta(name: string, size: number, mime = "application/octet-stream") {
  return { name, size, mime };
}

describe("attachment limit review", () => {
  test("accepts files within all limits including zero bytes", () => {
    const result = reviewIncoming([meta("a", 0), meta("b", 1024)], [], limits);
    expect(result.accepted.map((m) => m.name)).toEqual(["a", "b"]);
    expect(result.rejected).toEqual([]);
  });

  test("rejects files over 20 MiB", () => {
    const result = reviewIncoming([meta("big.bin", limits.maxFileBytes + 1)], [], limits);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].code).toBe("fileTooLarge");
  });

  test("rejects beyond the 40 MiB batch and keeps earlier accepted files", () => {
    const existing = [item({ size: 25 * 1024 * 1024, name: "held.bin" })];
    const result = reviewIncoming(
      [meta("a", 15 * 1024 * 1024), meta("b", 10 * 1024 * 1024)],
      existing,
      limits,
    );
    expect(result.accepted.map((m) => m.name)).toEqual(["a"]);
    expect(result.rejected[0]).toMatchObject({ name: "b", code: "batchTooLarge" });
  });

  test("counts existing rows toward the 5 file cap", () => {
    const existing = Array.from({ length: 4 }, (_, index) => item({ localId: `old${index}`, name: `old${index}.bin`, size: 1 }));
    const result = reviewIncoming([meta("new1", 1), meta("new2", 1)], existing, limits);
    expect(result.accepted.map((m) => m.name)).toEqual(["new1"]);
    expect(result.rejected[0].code).toBe("tooManyFiles");
  });

  test("name+size is NOT a duplicate signal: distinct picks with equal metadata are all accepted", () => {
    const existing = [item({ name: "dup.bin", size: 100 })];
    const result = reviewIncoming([meta("dup.bin", 100), meta("dup.bin", 100), meta("ok.bin", 1)], existing, limits);
    expect(result.accepted.map((m) => m.name)).toEqual(["dup.bin", "dup.bin", "ok.bin"]);
    expect(result.rejected).toEqual([]);
  });

  test("reserves source bytes (originalBytes) for compressed images, not the shrunken size", () => {
    // An existing smart image shrank 25 MiB → 400 bytes on upload, but its
    // source reserves 25 MiB of batch capacity: a 16 MiB incoming must overflow.
    const existing = [item({ kind: "image", name: "photo.jpg", size: 400, originalBytes: 25 * 1024 * 1024 })];
    const result = reviewIncoming([meta("next.jpg", 16 * 1024 * 1024, "image/jpeg")], existing, limits);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]).toMatchObject({ name: "next.jpg", code: "batchTooLarge" });
  });

  test("same name/size with different source bytes is not deduped at the review layer", () => {
    const existing = [item({ kind: "image", name: "photo.jpg", size: 400, originalBytes: 1000 })];
    const result = reviewIncoming([meta("photo.jpg", 1000, "image/jpeg")], existing, limits);
    expect(result.accepted.map((m) => m.name)).toEqual(["photo.jpg"]);
    expect(result.rejected).toEqual([]);
  });
});

describe("attachment type detection", () => {
  test("trusts image mime and otherwise falls back to extension", () => {
    expect(isImageMeta(meta("x", 1, "image/png"))).toBe(true);
    expect(isImageMeta(meta("photo.JPG", 1, ""))).toBe(true);
    expect(isImageMeta(meta("photo.heic", 1, ""))).toBe(true);
    expect(isImageMeta(meta("notes.txt", 1, ""))).toBe(false);
  });
});

describe("draft insertion math", () => {
  test("inserts with spacing, places caret after the token, and never glues to a suffix", () => {
    expect(insertPathsAt("", "", ["/tmp/a"])).toEqual({ text: "/tmp/a", caret: 6 });
    expect(insertPathsAt("read", "", ["/tmp/a"])).toEqual({ text: "read /tmp/a", caret: 11 });
    expect(insertPathsAt("read ", "", ["/tmp/a"])).toEqual({ text: "read /tmp/a", caret: 11 });
    expect(insertPathsAt("read\n", "", ["/tmp/a"]).text).toBe("read\n/tmp/a");
  });

  test("separates a token from non-whitespace text on both sides of a caret", () => {
    // Caret inside "prefixsuffix" used to produce /pathsuffix.
    expect(insertPathsAt("prefix", "suffix", ["/a"])).toEqual({ text: "prefix /a suffix", caret: 9 });
    // Existing surrounding whitespace is never doubled.
    expect(insertPathsAt("before ", " after", ["/a"])).toEqual({ text: "before /a after", caret: 9 });
    expect(insertPathsAt("", "suffix", ["/a"])).toEqual({ text: "/a suffix", caret: 2 });
  });

  test("joins multiple paths with one space and keeps the suffix once", () => {
    expect(insertPathsAt("ask about", " please", ["/a", "/b"]))
      .toEqual({ text: "ask about /a /b please", caret: 15 });
  });

  test("the exact final assembled text is checked against the prompt byte budget", () => {
    expect(insertionTextFits(insertPathsAt("", "", ["/tmp/a"]).text)).toBe(true);
    const longPrefix = "x".repeat(32768 - 2);
    expect(insertionTextFits(insertPathsAt(longPrefix, "", ["/a"]).text)).toBe(false);
    // Suffix is part of the same final preflight, not approximated.
    const tight = "x".repeat(32768 - 4);
    expect(insertionTextFits(insertPathsAt(tight, "tail", ["/a"]).text)).toBe(false);
  });
});

describe("committed path guards", () => {
  test("accepts plain absolute POSIX paths", () => {
    expect(safeCommittedPath("/tmp/x/a.txt")).toBe(true);
    expect(safeCommittedPath("/a")).toBe(true);
  });
  test("rejects relative, controlled, backslash and multiline paths", () => {
    expect(safeCommittedPath("tmp/x")).toBe(false);
    expect(safeCommittedPath("/tmp/x\\y")).toBe(false);
    expect(safeCommittedPath("/tmp/x\ny")).toBe(false);
    expect(safeCommittedPath("/tmp/x\u0000y")).toBe(false);
    expect(safeCommittedPath(42)).toBe(false);
  });
});

describe("upload state folding", () => {
  const base = item({ size: 100, status: "uploading", acknowledged: 40 });

  test("adopts a fully verified committed state", () => {
    const state: UploadStateLike = {
      upload_id: "u1", state: "committed", offset: 100, size: 100,
      sha256: "a".repeat(64), chunk_bytes: 32768, path: "/tmp/a.txt",
    };
    const committed = committedUpload(base, state);
    expect(committed).toMatchObject({ status: "committed", path: "/tmp/a.txt", acknowledged: 100 });
    expect(canInsert(committed!)).toBe(true);
  });

  test("rejects committed states with a bad path, digest, offset or size", () => {
    const good = { upload_id: "u1", offset: 100, size: 100, sha256: "a".repeat(64), chunk_bytes: 32768 } as const;
    expect(committedUpload(base, { ...good, state: "committed", path: "rel/x" })).toBeNull();
    expect(committedUpload(base, { ...good, state: "committed", path: "/x", sha256: "ZZ" })).toBeNull();
    expect(committedUpload(base, { ...good, state: "committed", path: "/x", offset: 99 })).toBeNull();
    expect(committedUpload(base, { ...good, state: "committed", path: "/x", size: 90 })).toBeNull();
  });

  test("folds uploading offsets and cancellation", () => {
    const uploading = foldUploadingState(base, {
      upload_id: "u1", state: "uploading", offset: 55, size: 100, sha256: "a".repeat(64), chunk_bytes: 32768,
    });
    expect(uploading.status).toBe("uploading");
    expect(uploading.acknowledged).toBe(55);
    const cancelled = foldUploadingState(base, {
      upload_id: "u1", state: "cancelled", offset: 55, size: 100, sha256: "a".repeat(64), chunk_bytes: 32768,
    });
    expect(cancelled.status).toBe("cancelled");
  });

  test("a malformed committed fold uses the localized bad-response text", () => {
    const malformed = foldUploadingState(
      base,
      { upload_id: "u1", state: "committed", offset: 100, size: 100, sha256: "a".repeat(64), chunk_bytes: 32768, path: "rel/x" },
      () => "localized-bad-response",
    );
    expect(malformed).toMatchObject({ status: "error", recoverable: true, errorText: "localized-bad-response" });
  });
});

describe("edited image limit branches", () => {
  test("per-file and batch rejections are distinct and preserve the original", () => {
    const overFile = editedImageRejection(limits.maxFileBytes + 1, 0, limits);
    expect(overFile).toMatchObject({ code: "fileTooLarge", limit: limits.maxFileBytes });
    // Within the file cap but over the batch budget with other rows counted.
    const overBatch = editedImageRejection(1024, limits.maxBatchBytes, limits);
    expect(overBatch).toMatchObject({ code: "batchTooLarge", limit: limits.maxBatchBytes });
    expect(editedImageRejection(1024, limits.maxBatchBytes - 1024, limits)).toBeNull();
  });
});

describe("upload error classification", () => {
  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
  test("unknown_outcome and reconnect codes stay recoverable and keep any cancel intent", () => {
    const patch = uploadErrorPatch(item(), new ProtocolError("unknown_outcome", "uncertain"), messageOf);
    expect(patch).toMatchObject({ status: "error", recoverable: true, cancelIntent: false });
    const timeout = uploadErrorPatch(item(), new ProtocolError("timeout", "slow"), messageOf);
    expect(timeout.recoverable).toBe(true);
    const cancelling = uploadErrorPatch(item({ cancelIntent: true }), new ProtocolError("unknown_outcome", "x"), messageOf);
    expect(cancelling).toMatchObject({ recoverable: true, cancelIntent: true });
  });
  test("workspace_not_found is the terminal expired-handle code, never not_found/expired", () => {
    const patch = uploadErrorPatch(item(), new ProtocolError("workspace_not_found", "gone"), messageOf);
    expect(patch).toMatchObject({ status: "error", recoverable: false, cancelIntent: false });
  });
  test("ordinary failures are visible errors without auto-retry", () => {
    const patch = uploadErrorPatch(item(), new ProtocolError("hash_mismatch", "bad"), messageOf);
    expect(patch).toMatchObject({ status: "error", recoverable: false });
  });
  test("abort leaves the item status to the cancel flow", () => {
    const patch = uploadErrorPatch(item({ status: "uploading" }), new DOMException("aborted", "AbortError"), messageOf);
    expect(patch.status).toBe("uploading");
  });
});

test("formats byte sizes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(20 * 1024 * 1024)).toBe("20 MiB");
});

describe("measured upload rate", () => {
  test("measures delta bytes over monotonic elapsed time and ETA over remaining bytes", () => {
    expect(measureUploadRate(1_000, 1_000, 5_000)).toEqual({ speedBps: 1_000, etaSeconds: 5 });
    expect(measureUploadRate(131_072, 1_000, 0)).toEqual({ speedBps: 131_072 });
  });

  test("returns no rate for zero, negative or non-finite samples", () => {
    expect(measureUploadRate(0, 100, 10)).toBeNull();
    expect(measureUploadRate(100, 0, 10)).toBeNull();
    expect(measureUploadRate(-1, 100, 10)).toBeNull();
    expect(measureUploadRate(100, -1, 10)).toBeNull();
    expect(measureUploadRate(Number.NaN, 100, 10)).toBeNull();
    expect(measureUploadRate(100, Number.POSITIVE_INFINITY, 10)).toBeNull();
    expect(measureUploadRate(100, 100, Number.NaN)).toBeNull();
  });
});

describe("speed and ETA display parts", () => {
  test("speed stays KiB/s below 1 MiB/s and switches to MiB/s above it", () => {
    expect(speedParts(20 * 1024)).toEqual({ value: 20, unit: "kib" });
    expect(speedParts(512)).toEqual({ value: 0.5, unit: "kib" });
    expect(speedParts(1_536 * 1024)).toEqual({ value: 1.5, unit: "mib" });
    expect(speedParts(200 * 1024 * 1024)).toEqual({ value: 200, unit: "mib" });
  });

  test("speed rejects non-positive and non-finite input", () => {
    expect(speedParts(0)).toBeNull();
    expect(speedParts(-1)).toBeNull();
    expect(speedParts(Number.NaN)).toBeNull();
  });

  test("ETA is whole seconds under a minute and rounded minutes beyond", () => {
    expect(etaParts(0.2)).toEqual({ kind: "seconds", value: 1 });
    expect(etaParts(45.4)).toEqual({ kind: "seconds", value: 46 });
    expect(etaParts(60)).toEqual({ kind: "minutes", value: 1 });
    expect(etaParts(80)).toEqual({ kind: "minutes", value: 1 });
    expect(etaParts(100)).toEqual({ kind: "minutes", value: 2 });
    expect(etaParts(0)).toBeNull();
    expect(etaParts(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
