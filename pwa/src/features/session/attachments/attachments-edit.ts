/**
 * Image-edit adoption for one queued attachment row: decode the editable
 * source, present the editor, validate the edited file against the pane
 * limits, and adopt it. Extracted from attachments-controller by duty; the
 * controller re-exports `editImage` so existing imports are unchanged.
 *
 * The transfer port is injected by the controller (which owns the production
 * lazy-load and the test-fake seam) via `setAttachmentEditPortLoader`, so this
 * module never back-imports the controller and no controller↔edit cycle forms.
 * Behavior and guards are preserved verbatim from the controller.
 */
import { haptic } from "../../../lib/dom";
import {
  HEADER_BYTES,
  jpegDimensions,
  pngDimensions,
  sniffFormat,
  sourceDimensionsSafe,
} from "../../../lib/attachment-image-policy";
import { attachT } from "./attach-copy";
import {
  isJpegCandidate,
  reviewLocalIncoming,
  LOCAL_INTAKE_LIMITS,
} from "./attachments-admission";
import {
  metaFromFile,
  type AttachmentItem,
  type AttachmentScope,
  type AttachmentTransferPort,
} from "./attach-model";
import {
  adoptEditedFile,
  attachmentScopeKey,
  queueSnapshot,
  reissueAttachment,
  runtimeCheckpoint,
  runtimeRemoved,
  runtimeSourceFile,
  setItemEditNote,
  setQueueNotice,
} from "./attachments-store";

/** Port resolver injected by the controller; avoids a controller↔edit cycle. */
type PortLoader = () => Promise<AttachmentTransferPort>;

let portLoader: PortLoader | null = null;

/**
 * Wire this module to the controller's transfer-port resolver. The controller
 * calls this once at module init, so a test fake injected via
 * `setAttachmentTransferPort` stays visible here without a back-import.
 */
export function setAttachmentEditPortLoader(loader: PortLoader | null): void {
  portLoader = loader;
}

async function transferPort(): Promise<AttachmentTransferPort> {
  if (portLoader) return portLoader();
  // Standalone fallback: the production adapter. Only reached if the
  // controller never wired the loader (it always does in normal use).
  const module = await import("./attachments-transfer");
  return module.productionAttachmentTransfer;
}

/** Read one row from its pane queue (mirrors the controller's read helper). */
function findItem(key: string, localId: string): AttachmentItem | null {
  return queueSnapshot(key)?.items.find((item) => item.localId === localId) ?? null;
}

/**
 * A row is open for editing only while nothing is running for it: an
 * unstarted queued row (not scheduled — a queued+scheduled row may already be
 * preparing), a finished upload (the edit uploads again under a new id), a
 * cancelled row, or a plain failure. Never a removed row and never one with a
 * remote upload handle that must be reconciled. Checked BEFORE the lazy
 * editor load / full decode AND after every await.
 */
function rowOpenForEdit(item: AttachmentItem | null, key: string, localId: string): item is AttachmentItem {
  if (!item) return false;
  const idle = (item.status === "queued" && !item.scheduled)
    || item.status === "committed"
    || item.status === "cancelled"
    || (item.status === "error" && !item.cancelIntent);
  if (!idle) return false;
  if (runtimeRemoved(key, localId) || runtimeCheckpoint(key, localId)) return false;
  return true;
}

/** Result of the bounded pre-decode geometry inspection. */
type EditableHeaderVerdict = "ok" | "oversized" | "unreadable";

/**
 * Validate a JPEG/PNG source's geometry from its bounded header BEFORE any
 * full browser decode: dimensions must be positive, at most 32768 per edge and
 * at most 24 megapixels (the shared image-policy contract). This reuses the
 * sibling policy parser byte-for-byte — no second format parser lives here.
 * A header whose dimensions cannot be established fails closed ("unreadable")
 * rather than falling back to a full-size main-thread decode of a possibly
 * oversized image. Any other sniffed format (GIF/WebP/…) skips this gate and
 * keeps the existing decode path, whose own catch keeps the original
 * uploadable on failure.
 */
async function inspectEditableHeader(file: File): Promise<EditableHeaderVerdict> {
  let scan: Uint8Array;
  try {
    scan = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  } catch {
    return "unreadable";
  }
  const format = sniffFormat(scan);
  if (format !== "jpeg" && format !== "png") return "ok";
  const dims = format === "jpeg" ? jpegDimensions(scan) : pngDimensions(scan);
  if (!dims) return "unreadable";
  return sourceDimensionsSafe(dims.width, dims.height) ? "ok" : "oversized";
}

/** MiB/KiB rounding for a byte limit, matching the controller formatter. */
function formatLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

export async function editImage(
  scope: AttachmentScope,
  localId: string,
  present: (input: {
    name: string;
    file: File;
    image: import("./image-editor/image-render").LoadedImage;
    /** Null on success; otherwise a user-facing reason the edit was rejected. */
    onApply: (file: File) => Promise<string | null>;
    onClose: () => void;
  }) => void,
): Promise<void> {
  const key = attachmentScopeKey(scope);
  const item = findItem(key, localId);
  // The editor opens the editable SOURCE, never the (possibly compressed)
  // upload file — re-encoding a compressed result would start a lossy chain.
  const originalFile = runtimeSourceFile(key, localId);
  if (!item || item.kind !== "image" || !originalFile) return;
  // Status/scheduled/checkpoint guard BEFORE any lazy load or decode: a row
  // that is scheduled (even while visibly queued), preparing/uploading, or
  // already holding a remote handle can never enter the editor. Revalidated
  // after every await below.
  if (!rowOpenForEdit(item, key, localId)) return;
  setItemEditNote(key, localId, "");
  const headerVerdict = await inspectEditableHeader(originalFile);
  if (!rowOpenForEdit(findItem(key, localId), key, localId)
      || runtimeSourceFile(key, localId) !== originalFile) {
    setQueueNotice(key, attachT("attach.scopeMoved"));
    return;
  }
  if (headerVerdict === "oversized") {
    setItemEditNote(key, localId, attachT("attach.editTooLarge"));
    haptic(2);
    return;
  }
  if (headerVerdict === "unreadable") {
    setItemEditNote(key, localId, attachT("attach.unsupported"));
    haptic(2);
    return;
  }
  const render = await import("./image-editor/image-render");
  // Recheck exact source + row-open AFTER the lazy editor load but BEFORE the
  // full decode: the marquee import is a real await and the row may have been
  // scheduled/removed/replaced in that gap. Guarding here avoids decoding a
  // file we will only discard.
  if (!rowOpenForEdit(findItem(key, localId), key, localId)
      || runtimeSourceFile(key, localId) !== originalFile) {
    setQueueNotice(key, attachT("attach.scopeMoved"));
    return;
  }
  let image: import("./image-editor/image-render").LoadedImage;
  try {
    image = await render.loadEditableImage(originalFile);
  } catch {
    // Any decode failure keeps the original selected and uploadable.
    setItemEditNote(key, localId, attachT("attach.unsupported"));
    haptic(2);
    return;
  }
  // Revalidate after the decode await: the row may have started uploading,
  // been scheduled/removed, or replaced by another edit in the meantime. The
  // source identity (not the upload file) gates this: a prepare that swapped
  // the upload file must not block editing.
  const current = findItem(key, localId);
  if (!rowOpenForEdit(current, key, localId)
      || runtimeSourceFile(key, localId) !== originalFile) {
    image.release();
    setQueueNotice(key, attachT("attach.scopeMoved"));
    return;
  }
  present({
    name: current.name,
    file: originalFile,
    image,
    onApply: (edited: File) => applyEditedImage(key, localId, originalFile, edited),
    onClose: () => image.release(),
  });
}

async function applyEditedImage(
  key: string,
  localId: string,
  originalFile: File,
  edited: File,
): Promise<string | null> {
  // Existing transferPort async boundary: the lazy load is a real await after
  // which the live row is re-read and re-validated before any write.
  await transferPort();
  // Re-read the live row after the await: still queued, unscheduled,
  // unstarted, same source.
  const item = findItem(key, localId);
  if (!rowOpenForEdit(item, key, localId) || runtimeSourceFile(key, localId) !== originalFile) {
    return attachT("attach.scopeMoved");
  }
  // The edit is validated against the LOCAL retained-source intake budget —
  // JPEG 40 MiB per file, other 20 MiB, whole batch 80 MiB — with every OTHER
  // row counted (each reserving its SOURCE bytes so a compressed row's
  // shrunken size can't let a future Original switch overflow the batch). The
  // remote 20/40 network gate is NOT applied here; it stays at the real
  // network start in the controller.
  const existing = queueSnapshot(key)?.items
    .filter((candidate) => candidate.localId !== localId) ?? [];
  const result = reviewLocalIncoming([metaFromFile(edited)], existing, LOCAL_INTAKE_LIMITS);
  const rejection = result.rejected[0];
  if (rejection) {
    const jpeg = isJpegCandidate(metaFromFile(edited));
    const limit = rejection.code === "fileTooLarge"
      ? formatLimit(jpeg ? LOCAL_INTAKE_LIMITS.jpegFileBytes : LOCAL_INTAKE_LIMITS.defaultFileBytes)
      : rejection.code === "batchTooLarge"
        ? formatLimit(LOCAL_INTAKE_LIMITS.batchBytes)
        : `${LOCAL_INTAKE_LIMITS.maxFiles}`;
    const reason = rejection.code === "fileTooLarge"
      ? attachT("err.fileTooLarge", { name: rejection.name, limit })
      : rejection.code === "batchTooLarge"
        ? attachT("err.batchTooLarge", { limit })
        : attachT("err.tooManyFiles", { limit });
    setQueueNotice(key, reason);
    haptic(2);
    return reason;
  }
  // A finished row uploads the edit under a new id: its old id is already
  // tombstoned in the recovery journal.
  const target = item.status === "committed" || item.status === "cancelled"
    ? reissueAttachment(key, localId)
    : localId;
  if (!target) return attachT("attach.scopeMoved");
  adoptEditedFile(key, target, edited, metaFromFile(edited));
  haptic(4);
  return null;
}
