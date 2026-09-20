import { describe, expect, test } from "bun:test";
import { ProtocolError } from "./protocol/errors.ts";
import { ATTACHMENT_UPLOAD_CHUNK_BYTES, type UploadState } from "./protocol/attachments.ts";
import { base64Decode } from "./protocol/bytes.ts";
import type { LiveSession } from "./protocol/session-types.ts";
import {
  ATTACHMENT_CHUNK_BYTES,
  ATTACHMENT_MAX_FILE_BYTES,
  cancelAttachment,
  hashAttachmentFile,
  inspectAttachment,
  resumeAttachment,
  uploadAttachment,
  validateAttachmentCheckpoint,
  type AttachmentCheckpoint,
} from "./attachment-transfer.ts";

const UPLOAD_ID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const SHA = "a".repeat(64);

function uploading(offset: number, size: number): UploadState {
  return { upload_id: UPLOAD_ID, state: "uploading", offset, size, sha256: SHA, chunk_bytes: ATTACHMENT_UPLOAD_CHUNK_BYTES };
}

function committed(size: number): UploadState {
  return {
    ...uploading(size, size),
    state: "committed",
    path: "/repo/.pairfob/attachments/1b7f/attachment.bin",
    relative_path: ".pairfob/attachments/1b7f/attachment.bin",
    name: "data.bin",
    mime: "application/octet-stream",
  };
}

function cancelled(size: number): UploadState {
  return { ...uploading(0, size), state: "cancelled" };
}

function makeFile(size: number, name = "data.bin", fill = 0): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i + fill) & 0xff;
  return new File([bytes], name, { type: "application/octet-stream" });
}

async function realDigest(file: File): Promise<string> {
  return hashAttachmentFile(file);
}

type MockSession = {
  session: LiveSession;
  calls: { op: string; params?: Record<string, unknown> }[];
};

type ActiveUpload = { upload_id: string; size: number; sha256: string };

/** Minimal mock that records calls and plays scripted UploadState replies. */
function mockSession(script: {
  begin?: (params: Record<string, unknown>) => UploadState;
  write?: (params: Record<string, unknown>) => UploadState;
  status?: () => UploadState | ProtocolError;
  commit?: () => UploadState;
  cancel?: () => UploadState;
}, initial?: ActiveUpload): MockSession {
  const calls: MockSession["calls"] = [];
  const active: ActiveUpload = initial ?? { upload_id: UPLOAD_ID, size: 0, sha256: SHA };
  const patched = <T extends UploadState>(state: T): T => ({ ...state, upload_id: active.upload_id, sha256: active.sha256 });
  const session = {
    workspaceUploadBegin: async (input: Record<string, unknown>) => {
      calls.push({ op: "begin", params: input });
      active.upload_id = input.upload_id as string;
      active.size = input.size as number;
      active.sha256 = input.sha256 as string;
      return script.begin ? patched(script.begin(input)) : patched(uploading(0, active.size));
    },
    workspaceUploadWrite: async (input: Record<string, unknown>) => {
      calls.push({ op: "write", params: input });
      if (script.write) return patched(script.write(input));
      const bytes = base64Decode(input.data_b64 as string).length;
      return patched(uploading((input.offset as number) + bytes, active.size));
    },
    workspaceUploadStatus: async () => {
      calls.push({ op: "status" });
      const result = script.status?.();
      if (result instanceof ProtocolError) throw result;
      return result === undefined ? patched(uploading(0, active.size)) : patched(result);
    },
    workspaceUploadCommit: async () => {
      calls.push({ op: "commit" });
      return script.commit ? patched(script.commit()) : patched(committed(active.size));
    },
    workspaceUploadCancel: async () => {
      calls.push({ op: "cancel" });
      return script.cancel ? patched(script.cancel()) : patched(cancelled(active.size));
    },
  } as unknown as LiveSession;
  return { session, calls };
}

async function checkpointFor(file: File, paneId = "w1:p1"): Promise<AttachmentCheckpoint> {
  return { uploadId: UPLOAD_ID, paneId, name: file.name, size: file.size, sha256: await realDigest(file), mime: "application/octet-stream" };
}

async function rejectProtocol(run: Promise<unknown>): Promise<ProtocolError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    return error as ProtocolError;
  }
  throw new Error("expected ProtocolError");
}

describe("uploadAttachment", () => {
  test("hashes first, emits checkpoint before any RPC, writes sequential chunks, commits once", async () => {
    const file = makeFile(ATTACHMENT_CHUNK_BYTES * 2 + 10);
    const { session, calls } = mockSession({
      write: (p) => uploading((p.offset as number) + base64Decode(p.data_b64 as string).length, file.size),
      commit: () => committed(file.size),
    });
    const order: string[] = [];
    const state = await uploadAttachment(session, "w1:p1", file, {
      onCheckpoint: (cp) => order.push(`checkpoint:${cp.uploadId}`),
    });
    expect(state.state).toBe("committed");
    expect(calls.map((c) => c.op)).toEqual(["begin", "write", "write", "write", "commit"]);
    expect(order).toEqual([`checkpoint:${state.upload_id}`]);
    const begin = calls[0].params as Record<string, unknown>;
    expect(begin.sha256).toBe(await realDigest(file));
    expect(begin.size).toBe(file.size);
    const offsets = calls.filter((c) => c.op === "write").map((c) => (c.params as Record<string, unknown>).offset);
    expect(offsets).toEqual([0, ATTACHMENT_CHUNK_BYTES, ATTACHMENT_CHUNK_BYTES * 2]);
  });

  test("zero-byte file skips writes and commits directly", async () => {
    const file = makeFile(0);
    const { session, calls } = mockSession({ commit: () => committed(0) });
    const state = await uploadAttachment(session, "w1:p1", file);
    expect(state.state).toBe("committed");
    expect(calls.map((c) => c.op)).toEqual(["begin", "commit"]);
  });

  test("rejects oversize files and unsupported sessions without any RPC", async () => {
    const big = { size: ATTACHMENT_MAX_FILE_BYTES + 1, name: "big", type: "" } as File;
    const { session, calls } = mockSession({});
    const error = await rejectProtocol(uploadAttachment(session, "w1:p1", big));
    expect(error.code).toBe("too_large");
    const legacy = {} as LiveSession;
    expect((await rejectProtocol(uploadAttachment(legacy, "w1:p1", makeFile(8)))).code).toBe("forbidden");
    expect(calls).toEqual([]);
  });

  test("mismatched acknowledged offset is a visible conflict, not a silent resend", async () => {
    const file = makeFile(ATTACHMENT_CHUNK_BYTES * 2);
    const { session, calls } = mockSession({ write: (p) => uploading(p.offset as number, file.size) });
    const error = await rejectProtocol(uploadAttachment(session, "w1:p1", file));
    expect(error.code).toBe("conflict");
    expect(calls.filter((c) => c.op === "write")).toHaveLength(1);
  });
  test("abort before commit stops scheduling; no commit or retry is issued", async () => {
    const file = makeFile(ATTACHMENT_CHUNK_BYTES * 3);
    const controller = new AbortController();
    const { session, calls } = mockSession({
      write: (p) => {
        controller.abort();
        return uploading((p.offset as number) + ATTACHMENT_CHUNK_BYTES, file.size);
      },
    });
    let aborted: unknown;
    try {
      await uploadAttachment(session, "w1:p1", file, { signal: controller.signal });
    } catch (error) {
      aborted = error;
    }
    expect((aborted as DOMException).name).toBe("AbortError");
    expect(calls.map((c) => c.op)).toEqual(["begin", "write"]);
  });

  test("progress reports acknowledged bytes only", async () => {
    const file = makeFile(ATTACHMENT_CHUNK_BYTES + 5);
    const { session } = mockSession({ commit: () => committed(file.size) });
    const seen: number[] = [];
    await uploadAttachment(session, "w1:p1", file, { onProgress: (ack) => seen.push(ack) });
    expect(seen).toEqual([0, ATTACHMENT_CHUNK_BYTES, file.size]);
  });
});

describe("resumeAttachment", () => {
  test("reads status FIRST and continues only from the verified server offset", async () => {
    const file = makeFile(ATTACHMENT_CHUNK_BYTES * 2);
    const checkpoint = await checkpointFor(file);
    const { session, calls } = mockSession({
      status: () => uploading(ATTACHMENT_CHUNK_BYTES, file.size),
    }, { upload_id: UPLOAD_ID, size: file.size, sha256: checkpoint.sha256 });
    const state = await resumeAttachment(session, checkpoint, file);
    expect(state.state).toBe("committed");
    expect(calls.map((c) => c.op)).toEqual(["status", "write", "commit"]);
    expect((calls[1].params as Record<string, unknown>).offset).toBe(ATTACHMENT_CHUNK_BYTES);
  });

  test("never replays begin for missing uploads", async () => {
    const file = makeFile(8);
    const checkpoint = await checkpointFor(file);
    const { session, calls } = mockSession({ status: () => new ProtocolError("workspace_not_found", "gone") }, { upload_id: UPLOAD_ID, size: 8, sha256: checkpoint.sha256 });
    const error = await rejectProtocol(resumeAttachment(session, checkpoint, file));
    expect(error.code).toBe("workspace_not_found");
    expect(calls.map((c) => c.op)).toEqual(["status"]);
  });

  test("committed upload returns the validated result without writes", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const { session, calls } = mockSession({
      status: () => committed(16),
    }, { upload_id: UPLOAD_ID, size: 16, sha256: checkpoint.sha256 });
    const state = await resumeAttachment(session, checkpoint, file);
    expect(state.state).toBe("committed");
    expect(calls.map((c) => c.op)).toEqual(["status"]);
  });

  test("committed reply whose name/mime disagrees with the checkpoint is conflict", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const drift: UploadState = { ...committed(16), name: "other.txt" };
    const { session } = mockSession({ status: () => drift }, { upload_id: UPLOAD_ID, size: 16, sha256: checkpoint.sha256 });
    expect((await rejectProtocol(resumeAttachment(session, checkpoint, file))).code).toBe("conflict");
  });

  test("uploading at full size commits exactly once", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const { session, calls } = mockSession({
      status: () => uploading(16, 16),
    }, { upload_id: UPLOAD_ID, size: 16, sha256: checkpoint.sha256 });
    const state = await resumeAttachment(session, checkpoint, file);
    expect(state.state).toBe("committed");
    expect(calls.map((c) => c.op)).toEqual(["status", "commit"]);
  });

  test("cancelled uploads are not resumed", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const { session } = mockSession({ status: () => cancelled(16) }, { upload_id: UPLOAD_ID, size: 16, sha256: checkpoint.sha256 });
    expect((await rejectProtocol(resumeAttachment(session, checkpoint, file))).code).toBe("conflict");
  });

  test("wrong local digest or server record mismatch is conflict", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const { session } = mockSession({ status: () => uploading(0, 16) }, { upload_id: UPLOAD_ID, size: 16, sha256: checkpoint.sha256 });
    const other = makeFile(16, "data.bin", 0x42); // same length, different bytes → different digest
    expect((await rejectProtocol(resumeAttachment(session, checkpoint, other))).code).toBe("conflict");
    const { session: drifted } = mockSession({ status: () => uploading(0, 32) }, { upload_id: UPLOAD_ID, size: 32, sha256: checkpoint.sha256 });
    expect((await rejectProtocol(resumeAttachment(drifted, checkpoint, file))).code).toBe("conflict");
  });
});

describe("inspectAttachment and cancelAttachment", () => {
  test("inspect is read-only and validates against the checkpoint", async () => {
    const file = makeFile(8);
    const checkpoint = await checkpointFor(file);
    const { session, calls } = mockSession({ status: () => uploading(4, 8) }, { upload_id: UPLOAD_ID, size: 8, sha256: checkpoint.sha256 });
    expect((await inspectAttachment(session, checkpoint)).offset).toBe(4);
    expect(calls.map((c) => c.op)).toEqual(["status"]);
    const { session: drifted } = mockSession({ status: () => uploading(4, 9) }, { upload_id: UPLOAD_ID, size: 9, sha256: checkpoint.sha256 });
    expect((await rejectProtocol(inspectAttachment(drifted, checkpoint))).code).toBe("conflict");
    const committedDrift: UploadState = { ...committed(8), mime: "text/plain" };
    const { session: committedWrongMime } = mockSession({ status: () => committedDrift }, { upload_id: UPLOAD_ID, size: 8, sha256: checkpoint.sha256 });
    expect((await rejectProtocol(inspectAttachment(committedWrongMime, checkpoint))).code).toBe("conflict");
  });

  test("cancel is one explicit mutation; committed replies are conflict", async () => {
    const file = makeFile(8);
    const checkpoint = await checkpointFor(file);
    const { session, calls } = mockSession({ cancel: () => cancelled(8) }, { upload_id: UPLOAD_ID, size: 8, sha256: checkpoint.sha256 });
    expect((await cancelAttachment(session, checkpoint)).state).toBe("cancelled");
    expect(calls.map((c) => c.op)).toEqual(["cancel"]);
    const { session: stillOpen } = mockSession({ cancel: () => uploading(0, 8) }, { upload_id: UPLOAD_ID, size: 8, sha256: checkpoint.sha256 });
    expect((await rejectProtocol(cancelAttachment(stillOpen, checkpoint))).code).toBe("conflict");
    const { session: finalized } = mockSession({ cancel: () => committed(8) }, { upload_id: UPLOAD_ID, size: 8, sha256: checkpoint.sha256 });
    expect((await rejectProtocol(cancelAttachment(finalized, checkpoint))).code).toBe("conflict");
  });
});

describe("unknown_outcome no-replay and explicit reconciliation", () => {
  const unknownOutcome = (): UploadState => { throw new ProtocolError("unknown_outcome", "连接在确认结果前中断"); };
  const retained = (value: AttachmentCheckpoint | null): AttachmentCheckpoint => {
    if (!value) throw new Error("checkpoint not retained");
    return value;
  };

  test("Begin unknown_outcome surfaces once and stops every later mutation", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({ begin: unknownOutcome });
    const error = await rejectProtocol(uploadAttachment(session, "w1:p1", file));
    expect(error.code).toBe("unknown_outcome");
    expect(calls.map((c) => c.op)).toEqual(["begin"]);
  });

  test("Write unknown_outcome stops at the failing write; explicit resume continues from the verified server offset", async () => {
    const file = makeFile(ATTACHMENT_CHUNK_BYTES * 3);
    let checkpoint: AttachmentCheckpoint | null = null;
    const { session, calls } = mockSession({ write: unknownOutcome });
    const error = await rejectProtocol(uploadAttachment(session, "w1:p1", file, { onCheckpoint: (cp) => { checkpoint = cp; } }));
    expect(error.code).toBe("unknown_outcome");
    expect(calls.map((c) => c.op)).toEqual(["begin", "write"]);

    const kept = retained(checkpoint);
    // The server consistently reports the uncertain write's effect; the
    // retained checkpoint drives one explicit resume, never an automatic replay.
    const resumed = mockSession(
      { status: () => uploading(ATTACHMENT_CHUNK_BYTES, file.size) },
      { upload_id: kept.uploadId, size: file.size, sha256: kept.sha256 },
    );
    const state = await resumeAttachment(resumed.session, kept, file);
    expect(state.state).toBe("committed");
    expect(resumed.calls.map((c) => c.op)).toEqual(["status", "write", "write", "commit"]);
    expect((resumed.calls[1].params as Record<string, unknown>).offset).toBe(ATTACHMENT_CHUNK_BYTES);
  });

  test("Commit unknown_outcome is visible; explicit status reconciliation confirms publication", async () => {
    const file = makeFile(ATTACHMENT_CHUNK_BYTES);
    let checkpoint: AttachmentCheckpoint | null = null;
    const { session, calls } = mockSession({ commit: unknownOutcome });
    const error = await rejectProtocol(uploadAttachment(session, "w1:p1", file, { onCheckpoint: (cp) => { checkpoint = cp; } }));
    expect(error.code).toBe("unknown_outcome");
    expect(calls.map((c) => c.op)).toEqual(["begin", "write", "commit"]);

    const kept = retained(checkpoint);
    const resumed = mockSession(
      { status: () => committed(file.size) },
      { upload_id: kept.uploadId, size: file.size, sha256: kept.sha256 },
    );
    const state = await resumeAttachment(resumed.session, kept, file);
    expect(state.state).toBe("committed");
    expect(resumed.calls.map((c) => c.op)).toEqual(["status"]);
  });
});

describe("checkpoint validation", () => {
  test("rejects malformed checkpoints before any RPC", async () => {
    const base: AttachmentCheckpoint = {
      uploadId: UPLOAD_ID, paneId: "w1:p1", name: "n", size: 8, sha256: SHA, mime: "text/plain",
    };
    const expectCode = (checkpoint: AttachmentCheckpoint, code: string) => {
      try {
        validateAttachmentCheckpoint(checkpoint);
        throw new Error("expected ProtocolError");
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolError);
        expect((error as ProtocolError).code).toBe(code);
      }
    };
    expect(() => validateAttachmentCheckpoint(base)).not.toThrow();
    expectCode({ ...base, uploadId: "nope" }, "invalid_argument");
    expectCode({ ...base, sha256: "x" }, "invalid_argument");
    expectCode({ ...base, size: -1 }, "invalid_argument");
    expectCode({ ...base, size: 1.5 }, "invalid_argument");
    expectCode({ ...base, size: ATTACHMENT_MAX_FILE_BYTES + 1 }, "too_large");
    expectCode({ ...base, name: "" }, "invalid_argument");
  });
});
