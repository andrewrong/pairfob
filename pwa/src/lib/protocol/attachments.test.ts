import { describe, expect, test } from "bun:test";
import { ProtocolError } from "./errors.ts";
import {
  ATTACHMENT_UPLOAD_CHUNK_BYTES,
  ATTACHMENT_UPLOAD_CHUNK_BYTES_V2,
  parseUploadState,
  parseUploadStateV2,
  validAttachmentDigest,
  validUploadID,
} from "./attachments.ts";

const UPLOAD_ID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const SHA = "a".repeat(64);

function uploadingState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    upload_id: UPLOAD_ID,
    state: "uploading",
    offset: 0,
    size: 65_536,
    sha256: SHA,
    chunk_bytes: ATTACHMENT_UPLOAD_CHUNK_BYTES,
    ...overrides,
  };
}

function committedState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...uploadingState({ offset: 65_536, state: "committed" }),
    path: "/repo/.pairfob/attachments/1b7f/attachment.txt",
    relative_path: ".pairfob/attachments/1b7f/attachment.txt",
    name: "notes.txt",
    mime: "text/plain",
    ...overrides,
  };
}

function uploadingStateV2(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return uploadingState({ chunk_bytes: ATTACHMENT_UPLOAD_CHUNK_BYTES_V2, ...overrides });
}

function committedStateV2(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...uploadingStateV2({ offset: 65_536, state: "committed" }),
    path: "/repo/.pairfob/attachments/1b7f/attachment.txt",
    relative_path: ".pairfob/attachments/1b7f/attachment.txt",
    name: "notes.txt",
    mime: "text/plain",
    ...overrides,
  };
}

describe("upload id and digest validators", () => {
  test("accept only canonical UUIDs and lower-case hex digests", () => {
    expect(validUploadID(UPLOAD_ID)).toBe(true);
    expect(validUploadID("nope")).toBe(false);
    expect(validUploadID("0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9")).toBe(true);
    expect(validAttachmentDigest(SHA)).toBe(true);
    expect(validAttachmentDigest("A".repeat(64))).toBe(false);
    expect(validAttachmentDigest("a".repeat(63))).toBe(false);
  });
});

describe("parseUploadState", () => {
  test("accepts exact active and committed shapes", () => {
    expect(parseUploadState(uploadingState())).toEqual(uploadingState());
    const committed = parseUploadState(committedState(), UPLOAD_ID);
    expect(committed.state).toBe("committed");
    if (committed.state === "committed") {
      expect(committed.path.startsWith("/")).toBe(true);
      expect(committed.relative_path.startsWith("/")).toBe(false);
    }
  });

  test("rejects wrong keys, bad values and mismatched id", () => {
    const badMessage = (value: unknown) => expect(() => parseUploadState(value)).toThrow(/响应格式不正确/);
    badMessage(null);
    badMessage([]);
    badMessage(uploadingState({ extra: true }));
    badMessage({ ...committedState(), state: "uploading" });
    badMessage(uploadingState({ state: "done" }));
    badMessage(uploadingState({ sha256: "A".repeat(64) }));
    badMessage(uploadingState({ offset: -1 }));
    badMessage(uploadingState({ offset: 65_537 }));
    badMessage(uploadingState({ chunk_bytes: 16_384 }));
    badMessage(committedState({ offset: 10 }));
    badMessage(committedState({ path: "relative/path" }));
    badMessage(committedState({ path: "/a/../b" }));
    badMessage(committedState({ relative_path: "../escape" }));
    badMessage(committedState({ name: "bad\u0000name" }));
    badMessage(committedState({ mime: "not a mime" }));
    expect(() => parseUploadState(uploadingState(), "9a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9"))
      .toThrowError(ProtocolError);
    try {
      parseUploadState(uploadingState(), "9a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9");
    } catch (error) {
      expect((error as ProtocolError).code).toBe("bad_message");
    }
  });
});

describe("parseUploadStateV2", () => {
  test("keeps the legacy parser pinned to 32768 and the V2 parser pinned to 131072", () => {
    expect(ATTACHMENT_UPLOAD_CHUNK_BYTES).toBe(32_768);
    expect(ATTACHMENT_UPLOAD_CHUNK_BYTES_V2).toBe(131_072);
    // Legacy parser still rejects the larger V2 chunk (not relaxed).
    expect(() => parseUploadState(uploadingStateV2())).toThrow(/响应格式不正确/);
    // V2 parser rejects the legacy 32768 chunk.
    expect(() => parseUploadStateV2(uploadingState())).toThrow(/响应格式不正确/);
  });

  test("accepts the same key set as the legacy parser, only chunk_bytes differs", () => {
    expect(parseUploadStateV2(uploadingStateV2())).toEqual(uploadingStateV2());
    const committed = parseUploadStateV2(committedStateV2(), UPLOAD_ID);
    expect(committed.state).toBe("committed");
    expect(committed.chunk_bytes).toBe(ATTACHMENT_UPLOAD_CHUNK_BYTES_V2);
    if (committed.state === "committed") {
      expect(committed.path.startsWith("/")).toBe(true);
      expect(committed.relative_path.startsWith("/")).toBe(false);
    }
  });

  test("rejects wrong keys, bad values and mismatched id at the V2 chunk size", () => {
    const badMessage = (value: unknown) => expect(() => parseUploadStateV2(value)).toThrow(/响应格式不正确/);
    badMessage(null);
    badMessage([]);
    badMessage(uploadingStateV2({ extra: true }));
    badMessage({ ...committedStateV2(), state: "uploading" });
    badMessage(uploadingStateV2({ state: "done" }));
    badMessage(uploadingStateV2({ sha256: "A".repeat(64) }));
    badMessage(uploadingStateV2({ offset: -1 }));
    badMessage(uploadingStateV2({ offset: 65_537 }));
    // 32768 (legacy) is no longer accepted by V2.
    badMessage(uploadingStateV2({ chunk_bytes: ATTACHMENT_UPLOAD_CHUNK_BYTES }));
    badMessage(committedStateV2({ offset: 10 }));
    badMessage(committedStateV2({ path: "relative/path" }));
    badMessage(committedStateV2({ path: "/a/../b" }));
    badMessage(committedStateV2({ relative_path: "../escape" }));
    badMessage(committedStateV2({ name: "bad\u0000name" }));
    badMessage(committedStateV2({ mime: "not a mime" }));
    expect(() => parseUploadStateV2(uploadingStateV2(), "9a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9")).toThrowError(ProtocolError);
  });
});
