/** Attachment row settlement, ownership checks and terminal cleanup. */
import { haptic } from "../../../lib/dom";
import { ProtocolError } from "../../../lib/protocol/errors";
import { attachT } from "./attach-copy";
import { committedUpload, foldUploadingState, type AttachmentScope, type AttachmentItem, type UploadStateLike } from "./attach-model";
import { clearRuntimeCheckpoint, patchItem, queueSnapshot, runtimeCheckpoint, runtimeGeneration, runtimeRemoved, setQueueNotice } from "./attachments-store";
import { requestRowDelete } from "./attachments-recovery";

/** Attempt/transient fields cleared on every terminal, error or demotion. */
export const ATTEMPT_FIELDS_CLEARED = {
  speedBps: undefined,
  etaSeconds: undefined,
  waiting: false,
  scheduled: false,
  transferPhase: undefined,
  compressing: false,
} as const satisfies Partial<AttachmentItem>;

export function findItem(key: string, localId: string): AttachmentItem | null {
  return queueSnapshot(key)?.items.find((item) => item.localId === localId) ?? null;
}

/** True only when the row is still the operation that claimed this generation. */
export function ownsGeneration(key: string, localId: string, generation: number): boolean {
  return !runtimeRemoved(key, localId) && runtimeGeneration(key, localId) === generation;
}

export function isActiveStatus(item: AttachmentItem): boolean {
  return item.status === "preparing" || item.status === "uploading" || item.status === "cancelling";
}

export function formatLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

/** Apply a terminal transfer state and delete its durable record (ordered). */
export function applyTerminalState(
  scope: AttachmentScope,
  key: string,
  localId: string,
  item: AttachmentItem,
  state: UploadStateLike,
): void {
  if (state.state === "committed") {
    const committed = committedUpload(item, state);
    if (committed) {
      // The file is finished on disk; no upload is in flight any more.
      clearRuntimeCheckpoint(key, localId);
      patchItem(key, localId, { ...committed, ...ATTEMPT_FIELDS_CLEARED });
      void requestRowDelete(scope, localId);
      haptic(8);
      return;
    }
    patchItem(key, localId, {
      status: "error",
      recoverable: true,
      cancelIntent: item.cancelIntent,
      errorText: attachT("err.commit", { message: attachT("err.badResponse") }),
      ...ATTEMPT_FIELDS_CLEARED,
    });
    return;
  }
  if (state.state === "cancelled") {
    // Confirmed cancelled: the remote handle is gone and the journal row with it.
    clearRuntimeCheckpoint(key, localId);
    void requestRowDelete(scope, localId);
  }
  patchItem(key, localId, {
    ...foldUploadingState(item, state, () => attachT("err.badResponse")),
    ...ATTEMPT_FIELDS_CLEARED,
  });
}

function codeOf(error: unknown): string {
  return error instanceof ProtocolError ? error.code : "";
}

/** Definite missing-handle signal (daemon lost the upload on restart). */
export function isExpiredError(error: unknown): boolean {
  return codeOf(error) === "workspace_not_found";
}

/**
 * A definite workspace_not_found: the remote handle is gone. The unfinished
 * reference is cleared and any cancel intent ends with an honest EXPIRED
 * state — never a false "deleted/cancelled". A finished file (if any) is
 * untouched.
 */
export function handleExpiredHandle(scope: AttachmentScope, key: string, localId: string): void {
  clearRuntimeCheckpoint(key, localId);
  void requestRowDelete(scope, localId);
  patchItem(key, localId, {
    status: "error",
    recoverable: false,
    cancelIntent: false,
    errorText: attachT("err.expired"),
    ...ATTEMPT_FIELDS_CLEARED,
  });
}

export function retainUnresolvedCancel(key: string, localId: string, text: string): void {
  patchItem(key, localId, {
    status: "error",
    recoverable: false,
    cancelIntent: true,
    errorText: text,
    ...ATTEMPT_FIELDS_CLEARED,
  });
}

/** Demote a row whose owner scope/session went stale across a lazy boundary. */
export function demoteOnInactiveGate(key: string, localId: string): void {
  patchItem(key, localId, runtimeCheckpoint(key, localId)
    ? { status: "error", recoverable: true, errorText: "", cancelIntent: false, ...ATTEMPT_FIELDS_CLEARED }
    : { status: "queued", errorText: "", recoverable: false, ...ATTEMPT_FIELDS_CLEARED });
  setQueueNotice(key, attachT("err.gate"));
}
