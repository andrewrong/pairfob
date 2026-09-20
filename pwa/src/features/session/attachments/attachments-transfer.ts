/**
 * Wire adapter for attachment uploads: the only attachment UI module that
 * calls the transfer API in `lib/attachment-transfer`. The rest of the UI
 * depends on the structural `AttachmentTransferPort`, so its tests run with
 * an in-memory fake and never touch the network.
 */
import {
  ATTACHMENT_MAX_BATCH_BYTES,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_FILES,
  cancelAttachment as cancelAttachmentTransfer,
  inspectAttachment as inspectAttachmentTransfer,
  resumeAttachment as resumeAttachmentTransfer,
  uploadAttachment as uploadAttachmentTransfer,
} from "../../../lib/attachment-transfer";
import type { LiveSession } from "../../../lib/protocol/client";
import type {
  AttachmentCheckpoint,
  AttachmentTransferOptions,
  AttachmentTransferPort,
  UploadStateLike,
} from "./attach-model";

// A transport switch invalidates the session's V2 capability cache. Refresh
// that read-only authority before reconciling a retained V2 handle; never
// downgrade the handle or infer support from the methods' presence.
async function refreshCheckpointCapability(session: LiveSession, checkpoint: AttachmentCheckpoint): Promise<void> {
  if (checkpoint.version === 2 && !session.supportsUploadV2?.()) await session.getConfig();
}

export const productionAttachmentTransfer: AttachmentTransferPort = {
  limits: {
    maxFileBytes: ATTACHMENT_MAX_FILE_BYTES,
    maxBatchBytes: ATTACHMENT_MAX_BATCH_BYTES,
    maxFiles: ATTACHMENT_MAX_FILES,
  },
  upload(session, paneId, file, options?: AttachmentTransferOptions) {
    return uploadAttachmentTransfer(
      session as LiveSession,
      paneId,
      file,
      options,
    ) as Promise<UploadStateLike>;
  },
  async resume(session, checkpoint: AttachmentCheckpoint, file, options?: AttachmentTransferOptions) {
    await refreshCheckpointCapability(session as LiveSession, checkpoint);
    return resumeAttachmentTransfer(
      session as LiveSession,
      checkpoint,
      file,
      options,
    ) as Promise<UploadStateLike>;
  },
  async inspect(session, checkpoint: AttachmentCheckpoint) {
    await refreshCheckpointCapability(session as LiveSession, checkpoint);
    return inspectAttachmentTransfer(session as LiveSession, checkpoint) as Promise<UploadStateLike>;
  },
  async cancel(session, checkpoint: AttachmentCheckpoint) {
    await refreshCheckpointCapability(session as LiveSession, checkpoint);
    return cancelAttachmentTransfer(session as LiveSession, checkpoint) as Promise<UploadStateLike>;
  },
};
