/**
 * Transfer integration with the attachment journal boundary:
 *
 *  - onCheckpoint may be async; Begin waits for persistence, a rejection
 *    blocks Begin, and an abort during the wait blocks Begin;
 *  - onStage is diagnostics-only: the expected boundary sequence fires for
 *    upload/resume/inspect, and a throwing (sync or async) observer never
 *    fails the transfer.
 *
 * Uses the same fake LiveSession pattern as attachment-transfer.test.ts:
 * scripted RPC replies, real local hashing. No wire behaviour changes and
 * resume never replays Begin.
 */
import { describe, expect, test } from "bun:test";
import { ATTACHMENT_UPLOAD_CHUNK_BYTES, type UploadState } from "./protocol/attachments.ts";
import { base64Decode } from "./protocol/bytes.ts";
import type { LiveSession } from "./protocol/session-types.ts";
import {
  hashAttachmentFile,
  inspectAttachment,
  resumeAttachment,
  uploadAttachment,
  type AttachmentCheckpoint,
  type AttachmentTransferStage,
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

function makeFile(size: number, fill = 0): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i + fill) & 0xff;
  return new File([bytes], "data.bin", { type: "application/octet-stream" });
}

type Call = { op: string; params?: Record<string, unknown> };

type MockScript = {
  begin?: (params: Record<string, unknown>) => UploadState;
  write?: (params: Record<string, unknown>) => UploadState;
  status?: () => UploadState;
  commit?: () => UploadState;
};

function mockSession(script: MockScript, size: number, initialSha = SHA) {
  const calls: Call[] = [];
  const active = { upload_id: UPLOAD_ID, size, sha256: initialSha };
  const patched = <T extends UploadState>(state: T): T => ({
    ...state,
    upload_id: active.upload_id,
    size: active.size,
    sha256: active.sha256,
  });
  const session = {
    workspaceUploadBegin: async (input: Record<string, unknown>) => {
      calls.push({ op: "begin", params: input });
      active.upload_id = input.upload_id as string;
      active.sha256 = input.sha256 as string;
      active.size = input.size as number;
      return patched(script.begin ? script.begin(input) : uploading(0, active.size));
    },
    workspaceUploadWrite: async (input: Record<string, unknown>) => {
      calls.push({ op: "write", params: input });
      if (script.write) return patched(script.write(input));
      return patched(uploading((input.offset as number) + base64Decode(input.data_b64 as string).length, active.size));
    },
    workspaceUploadStatus: async () => {
      calls.push({ op: "status" });
      return patched(script.status ? script.status() : uploading(0, active.size));
    },
    workspaceUploadCommit: async () => {
      calls.push({ op: "commit" });
      return patched(script.commit ? script.commit() : committed(active.size));
    },
    workspaceUploadCancel: async () => {
      calls.push({ op: "cancel" });
      return patched({ ...uploading(0, active.size), state: "cancelled" as const });
    },
  } as unknown as LiveSession;
  return { session, calls };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function checkpointFor(file: File): Promise<AttachmentCheckpoint> {
  return {
    uploadId: UPLOAD_ID,
    paneId: "w1:p1",
    name: file.name,
    size: file.size,
    sha256: await hashAttachmentFile(file),
    mime: "application/octet-stream",
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("async onCheckpoint gates Begin", () => {
  test("a deferred checkpoint persistence blocks Begin until it resolves, then proceeds", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({ commit: () => committed(8) }, 8);
    const gate = deferred<void>();
    const checkpointEntered = deferred<void>();
    const done = uploadAttachment(session, "w1:p1", file, {
      onCheckpoint: () => {
        checkpointEntered.resolve(undefined);
        return gate.promise;
      },
    });

    await checkpointEntered.promise;
    await flushMicrotasks();
    expect(calls.map((c) => c.op)).not.toContain("begin"); // persistence pending
    expect(calls.map((c) => c.op)).not.toContain("write");

    gate.resolve(undefined);
    const state = await done;
    expect(state.state).toBe("committed");
    expect(calls.map((c) => c.op)).toEqual(["begin", "write", "commit"]);
  });

  test("checkpoint rejection fails the upload and never sends Begin", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({}, 8);
    await expect(uploadAttachment(session, "w1:p1", file, {
      onCheckpoint: () => Promise.reject(new Error("journal write failed")),
    })).rejects.toThrow("journal write failed");
    expect(calls).toEqual([]); // not even Begin
  });

  test("an abort while persistence is awaited blocks Begin", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({}, 8);
    const controller = new AbortController();
    const gate = deferred<void>();
    const checkpointEntered = deferred<void>();
    const done = uploadAttachment(session, "w1:p1", file, {
      signal: controller.signal,
      onCheckpoint: () => {
        checkpointEntered.resolve(undefined);
        return gate.promise;
      },
    });

    // Abort strictly while the persistence promise is pending (hashing has
    // already finished), so the post-await checkAbort is what blocks Begin.
    await checkpointEntered.promise;
    controller.abort();
    gate.resolve(undefined);
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual([]);
  });

  test("a synchronous void onCheckpoint stays compatible", async () => {
    const file = makeFile(8);
    const { session } = mockSession({ commit: () => committed(8) }, 8);
    let seen: AttachmentCheckpoint | null = null;
    const state = await uploadAttachment(session, "w1:p1", file, {
      onCheckpoint: (cp) => { seen = cp; },
    });
    expect(state.state).toBe("committed");
    expect(seen?.uploadId).toBeTruthy();
  });
});

describe("onStage boundary sequence", () => {
  test("upload of a non-empty file: hashing -> begin -> sending -> commit", async () => {
    const file = makeFile(ATTACHMENT_UPLOAD_CHUNK_BYTES + 5);
    // Default write mock acks the exact bytes sent, so the tail chunk ends
    // exactly at file.size.
    const { session } = mockSession({ commit: () => committed(file.size) }, file.size);
    const stages: AttachmentTransferStage[] = [];
    await uploadAttachment(session, "w1:p1", file, { onStage: (s) => { stages.push(s); } });
    expect(stages).toEqual(["hashing", "begin", "sending", "commit"]);
  });

  test("upload of an empty file skips sending: hashing -> begin -> commit", async () => {
    const file = makeFile(0);
    const { session } = mockSession({ commit: () => committed(0) }, 0);
    const stages: AttachmentTransferStage[] = [];
    await uploadAttachment(session, "w1:p1", file, { onStage: (s) => { stages.push(s); } });
    expect(stages).toEqual(["hashing", "begin", "commit"]);
  });

  test("resume with bytes outstanding: status -> hashing -> sending -> commit, no begin", async () => {
    const file = makeFile(ATTACHMENT_UPLOAD_CHUNK_BYTES * 2);
    const checkpoint = await checkpointFor(file);
    const { session, calls } = mockSession({
      status: () => uploading(ATTACHMENT_UPLOAD_CHUNK_BYTES, file.size),
      commit: () => committed(file.size),
    }, file.size, checkpoint.sha256);
    const stages: AttachmentTransferStage[] = [];
    await resumeAttachment(session, checkpoint, file, { onStage: (s) => { stages.push(s); } });
    expect(stages).toEqual(["status", "hashing", "sending", "commit"]);
    expect(calls.map((c) => c.op)).toEqual(["status", "write", "commit"]);
  });

  test("resume already fully acknowledged: status -> hashing -> commit", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const { session } = mockSession({ status: () => uploading(16, 16) }, 16, checkpoint.sha256);
    const stages: AttachmentTransferStage[] = [];
    await resumeAttachment(session, checkpoint, file, { onStage: (s) => { stages.push(s); } });
    expect(stages).toEqual(["status", "hashing", "commit"]);
  });

  test("resume already committed: status -> hashing only", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const { session } = mockSession({ status: () => committed(16) }, 16, checkpoint.sha256);
    const stages: AttachmentTransferStage[] = [];
    const state = await resumeAttachment(session, checkpoint, file, {
      onStage: (s) => { stages.push(s); },
    });
    expect(state.state).toBe("committed");
    expect(stages).toEqual(["status", "hashing"]);
  });

  test("inspect: status only", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const { session } = mockSession({ status: () => uploading(0, 16) }, 16, checkpoint.sha256);
    const stages: AttachmentTransferStage[] = [];
    await inspectAttachment(session, checkpoint, { onStage: (s) => { stages.push(s); } });
    expect(stages).toEqual(["status"]);
  });
});

describe("onStage diagnostics never fail the transfer", () => {
  test("a synchronously throwing onStage does not change the upload", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({ commit: () => committed(8) }, 8);
    const state = await uploadAttachment(session, "w1:p1", file, {
      onStage: () => { throw new Error("observer exploded"); },
    });
    expect(state.state).toBe("committed");
    expect(calls.map((c) => c.op)).toEqual(["begin", "write", "commit"]);
  });

  test("an async-rejecting onStage is swallowed too", async () => {
    const file = makeFile(8);
    const { session } = mockSession({ commit: () => committed(8) }, 8);
    const stages: AttachmentTransferStage[] = [];
    const state = await uploadAttachment(session, "w1:p1", file, {
      onStage: async (s) => {
        stages.push(s);
        throw new Error("async observer exploded");
      },
    });
    expect(state.state).toBe("committed");
    // Every stage still fired despite the previous rejection.
    expect(stages).toEqual(["hashing", "begin", "sending", "commit"]);
  });
});

describe("onStage is fire-and-forget: observer promises never gate the wire", () => {
  test("a pending-forever observer promise still lets the upload finish", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({ commit: () => committed(8) }, 8);
    const never = new Promise<void>(() => {
      /* intentionally never resolves */
    });
    const state = await uploadAttachment(session, "w1:p1", file, {
      onStage: () => never,
    });
    expect(state.state).toBe("committed");
    expect(calls.map((c) => c.op)).toEqual(["begin", "write", "commit"]);
  });

  test("an already-rejected observer promise is tail-caught (no unhandled rejection)", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({ commit: () => committed(8) }, 8);
    let unhandled = 0;
    const onUnhandled = (): void => {
      unhandled += 1;
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const state = await uploadAttachment(session, "w1:p1", file, {
        onStage: () => Promise.reject(new Error("observer rejected")),
      });
      expect(state.state).toBe("committed");
      // Give any (incorrect) late rejection notification time to arrive.
      await flushMicrotasks();
      await flushMicrotasks();
      expect(unhandled).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(calls.map((c) => c.op)).toEqual(["begin", "write", "commit"]);
  });

  test("a synchronous abort in the begin observer blocks Begin (no Begin RPC)", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({}, 8);
    const controller = new AbortController();
    const stages: AttachmentTransferStage[] = [];
    const done = uploadAttachment(session, "w1:p1", file, {
      signal: controller.signal,
      onStage: (s) => {
        stages.push(s);
        if (s === "begin") controller.abort();
      },
    });
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(stages).toEqual(["hashing", "begin"]);
    expect(calls.map((c) => c.op)).toEqual([]); // Begin never sent
  });

  test("a synchronous abort in the commit observer allows writes but blocks Commit", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({ commit: () => committed(8) }, 8);
    const controller = new AbortController();
    const done = uploadAttachment(session, "w1:p1", file, {
      signal: controller.signal,
      onStage: (s) => {
        if (s === "commit") controller.abort();
      },
    });
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.map((c) => c.op)).toEqual(["begin", "write"]); // Commit never sent
  });

  test("a synchronous abort in the status observer blocks inspect's Status RPC", async () => {
    const file = makeFile(16);
    const checkpoint = await checkpointFor(file);
    const { session, calls } = mockSession({ status: () => uploading(0, 16) }, 16, checkpoint.sha256);
    const controller = new AbortController();
    const done = inspectAttachment(session, checkpoint, {
      signal: controller.signal,
      onStage: (s) => {
        if (s === "status") controller.abort();
      },
    });
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.map((c) => c.op)).toEqual([]); // Status never sent
  });

  test("a throwing aborting observer still blocks the next mutation", async () => {
    const file = makeFile(8);
    const { session, calls } = mockSession({}, 8);
    const controller = new AbortController();
    const done = uploadAttachment(session, "w1:p1", file, {
      signal: controller.signal,
      onStage: (s) => {
        if (s === "begin") {
          controller.abort();
          throw new Error("observer exploded while aborting");
        }
      },
    });
    // The throw is swallowed by emitStage; the post-stage abort recheck is
    // what rejects the transfer — with AbortError, not the observer error.
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.map((c) => c.op)).toEqual([]);
  });
});
