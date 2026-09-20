import { expect, test } from "bun:test";
import { ATTACHMENT_UPLOAD_CHUNK_BYTES_V2 } from "../../../lib/protocol/attachments";
import type { LiveSession } from "../../../lib/protocol/client";
import { productionAttachmentTransfer } from "./attachments-transfer";
import type { AttachmentCheckpoint } from "./attach-model";

const checkpoint: AttachmentCheckpoint = {
  version: 2, uploadId: "12345678-1234-4234-8234-123456789abc", paneId: "p1",
  name: "a.bin", mime: "application/octet-stream", size: 8, sha256: "a".repeat(64),
};
function fixture(advertised: boolean, cached = false) {
  const calls: string[] = [];
  const mutation = async () => { calls.push("mutation"); throw Error("unexpected mutation"); };
  const session = {
    supportsUploadV2: () => cached,
    getConfig: async () => { calls.push("GetConfig"); cached = advertised; return { capabilities: { upload_file_v2: advertised } }; },
    workspaceUploadBeginV2: mutation, workspaceUploadWriteV2: mutation,
    workspaceUploadCommitV2: mutation, workspaceUploadCancelV2: mutation,
    workspaceUploadStatusV2: async () => {
      calls.push("StatusV2");
      return { upload_id: checkpoint.uploadId, state: "uploading", offset: 4,
        size: 8, sha256: checkpoint.sha256, chunk_bytes: ATTACHMENT_UPLOAD_CHUNK_BYTES_V2 };
    },
  } as unknown as LiveSession;
  return { session, calls };
}
test("status refreshes invalidated V2 authority after switching transport without sending file mutations", async () => {
  const { session, calls } = fixture(true);
  expect((await productionAttachmentTransfer.inspect(session, checkpoint)).offset).toBe(4);
  expect(calls).toEqual(["GetConfig", "StatusV2"]);
});
test("status with a valid capability cache needs only StatusV2", async () => {
  const { session, calls } = fixture(true, true);
  await productionAttachmentTransfer.inspect(session, checkpoint);
  expect(calls).toEqual(["StatusV2"]);
});
test("a daemon that no longer advertises V2 fails closed after the config read", async () => {
  const { session, calls } = fixture(false);
  await expect(productionAttachmentTransfer.inspect(session, checkpoint)).rejects.toMatchObject({ code: "forbidden" });
  expect(calls).toEqual(["GetConfig"]);
});
