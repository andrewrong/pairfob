/**
 * Pure attachment admission limits and byte accounting.
 *
 * Two distinct budgets live here, matching the product contract:
 *
 * 1. LOCAL intake (the pane's retained source capacity, shown in the sheet as
 *    the capacity line): JPEG candidates may be picked up to 40 MiB each while
 *    every other file caps at 20 MiB, the whole retained source batch must
 *    stay under 80 MiB, and at most 5 files per pane. This governs what the
 *    picker accepts and what the UI displays as local capacity — it is NOT the
 *    remote upload limit.
 *
 * 2. FINAL network admission (enforced at each upload's network start): the
 *    per-file cap stays 20 MiB and the cumulative ACTUAL upload batch stays
 *    under 40 MiB. Actual bytes are what count — the current job's prepared
 *    bytes plus OTHER rows' committed actual sizes plus retained checkpoint
 *    actual sizes — never unprepared queued-source estimates. (Contrast: three
 *    21 MiB JPEGs that each compress to 1 MiB must all be allowed; summing
 *    their queued source sizes would falsely reject the first as 41 > 40.)
 *
 * This module is pure (no DOM, no stores). The local intake is used by the
 * picking flow; the final-admission helper is exposed for the controller's
 * network start but is intentionally NOT wired there yet this phase.
 */
import type {
  AttachmentItem,
  IncomingMeta,
  IncomingRejection,
  ReviewResult,
} from "./attach-model";

// --- Local intake ---------------------------------------------------------------

export const LOCAL_INTAKE_DEFAULT_FILE_BYTES = 20 * 1024 * 1024;
export const LOCAL_INTAKE_JPEG_FILE_BYTES = 40 * 1024 * 1024;
export const LOCAL_INTAKE_BATCH_BYTES = 80 * 1024 * 1024;
export const LOCAL_INTAKE_MAX_FILES = 5;

export type LocalIntakeLimits = {
  readonly defaultFileBytes: number;
  readonly jpegFileBytes: number;
  readonly batchBytes: number;
  readonly maxFiles: number;
};

export const LOCAL_INTAKE_LIMITS: LocalIntakeLimits = {
  defaultFileBytes: LOCAL_INTAKE_DEFAULT_FILE_BYTES,
  jpegFileBytes: LOCAL_INTAKE_JPEG_FILE_BYTES,
  batchBytes: LOCAL_INTAKE_BATCH_BYTES,
  maxFiles: LOCAL_INTAKE_MAX_FILES,
};

const JPEG_NAME = /\.jpe?g$/iu;

/** A JPEG candidate may be picked up to the larger local file cap. */
export function isJpegCandidate(meta: IncomingMeta): boolean {
  return meta.mime === "image/jpeg" || JPEG_NAME.test(meta.name);
}

/**
 * Source/original bytes reserve intake capacity: a compressed upload's
 * shrunken size must not let extra raw files in whose later Original switch
 * would exceed the batch. Mirrors attach-model's reserved-bytes rule.
 */
function reservedBytes(item: AttachmentItem): number {
  return Math.max(item.originalBytes ?? item.size, item.size);
}

/**
 * Review a native-pick selection against the LOCAL intake budget using the
 * queue AS IT STANDS. JPEG candidates get the 40 MiB per-file cap, everything
 * else 20 MiB; the retained source batch must stay under 80 MiB and the file
 * count under 5. Returns the same ReviewResult shape as the model's
 * reviewIncoming so rejection handling is shared.
 */
export function reviewLocalIncoming(
  incoming: readonly IncomingMeta[],
  existing: readonly AttachmentItem[],
  limits: LocalIntakeLimits = LOCAL_INTAKE_LIMITS,
): ReviewResult {
  const accepted: IncomingMeta[] = [];
  const rejected: IncomingRejection[] = [];
  let batchBytes = existing.reduce((total, item) => total + reservedBytes(item), 0);
  let fileCount = existing.length;
  for (const meta of incoming) {
    const fileLimit = isJpegCandidate(meta) ? limits.jpegFileBytes : limits.defaultFileBytes;
    if (meta.size > fileLimit) {
      rejected.push({ name: meta.name, code: "fileTooLarge" });
      continue;
    }
    if (batchBytes + meta.size > limits.batchBytes) {
      rejected.push({ name: meta.name, code: "batchTooLarge" });
      continue;
    }
    if (fileCount >= limits.maxFiles) {
      rejected.push({ name: meta.name, code: "tooManyFiles" });
      continue;
    }
    accepted.push(meta);
    batchBytes += meta.size;
    fileCount += 1;
  }
  return { accepted, rejected };
}

// --- Final network admission ----------------------------------------------------

export const FINAL_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const FINAL_MAX_BATCH_BYTES = 40 * 1024 * 1024;

export function exceedsFinalFileLimit(bytes: number, fileBytes: number = FINAL_MAX_FILE_BYTES): boolean {
  return bytes > fileBytes;
}

/**
 * The ACTUAL upload bytes reserved by a queue's rows at a network start:
 * the current job's prepared bytes plus OTHER rows' committed actual sizes
 * plus retained checkpoint actual sizes. Only real, resolved byte counts
 * count here — never an unprepared queued source estimate (a JPEG waiting to
 * compress is counted at its prepared size once it is, and its queued 21 MiB
 * source must not reserve capacity while it will actually upload 1 MiB).
 *
 * `currentBytes` is the current job's prepared/actual upload bytes. On a
 * resume the caller passes the current job's bytes WITHOUT double-counting
 * its own retained checkpoint (see finalAdmissionResumeBytes).
 */
export type AdmissionContributions = {
  currentBytes: number;
  committedActual: readonly number[];
  checkpointActual: readonly number[];
};

export function sum(bytes: readonly number[]): number {
  return bytes.reduce((total, value) => total + value, 0);
}

export function finalAdmissionBytes(args: AdmissionContributions): number {
  return args.currentBytes + sum(args.committedActual) + sum(args.checkpointActual);
}

export function finalAdmissionAllowed(
  args: AdmissionContributions,
  batchBytes: number = FINAL_MAX_BATCH_BYTES,
): boolean {
  return finalAdmissionBytes(args) <= batchBytes;
}

/**
 * Convenience for a resume, which must not double-count its own already
 * retained checkpoint: the caller passes the resumed row's current bytes
 * explicitly and excludes that row's own checkpoint from `checkpointActual`.
 */
export function resumeAdmissionBytes(
  currentBytes: number,
  otherCommittedActual: readonly number[],
  otherCheckpointActual: readonly number[],
): number {
  return finalAdmissionBytes({
    currentBytes,
    committedActual: otherCommittedActual,
    checkpointActual: otherCheckpointActual,
  });
}