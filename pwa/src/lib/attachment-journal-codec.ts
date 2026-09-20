/**
 * Attachment journal record codec.
 *
 * One attachment row, ready for durable storage: identity key
 * (daemonId, paneId, localId), the editable SOURCE File, the file that will
 * actually be uploaded (the source, or a compressed image), the published
 * AttachmentItem, and the optional upload checkpoint.
 *
 * This module ONLY converts between the in-memory record and a
 * structured-cloneable stored shape. It never reads file bytes (no
 * arrayBuffer / no hashing): Blobs are stored by reference, source bytes stay
 * exact, and decode rebuilds fresh File objects with the saved name/type/
 * lastModified. IndexedDB wiring, transfers and tests live elsewhere.
 *
 * Validation is fail-closed and identical on both directions:
 *  - version is exactly 1;
 *  - ids are non-empty strings <= 256 chars with no NUL (no regex invented);
 *  - files are real File/Blob instances with bounded name/type, finite
 *    lastModified, safe non-negative byte sizes; empty files are allowed;
 *  - the item keeps a whitelist of known fields only — anything else on a
 *    decoded record (forward-compatible fields beyond imageIntent /
 *    transferPhase / stageTimings and the other current optionals) is
 *    dropped, never stored or reconstructed;
 *  - item name/size/mime must match the upload File, and a checkpoint is
 *    accepted only through validateAttachmentCheckpoint plus pane/name/size/
 *    normalized-mime cross-checks against the upload File;
 *  - source <= 40 MiB; upload <= 20 MiB once a checkpoint exists (an upload
 *    actually began under the transfer limit), 40 MiB before one.
 *
 * Plain Errors are thrown for this module's own validation failures; the
 * reused checkpoint validator may throw its existing ProtocolError. decode
 * swallows everything and returns null on any invalid record.
 */
import {
  ATTACHMENT_MAX_FILE_BYTES,
  validateAttachmentCheckpoint,
} from "./attachment-transfer.ts";
// Type-only: the attach feature layer must never be a runtime dependency of a
// lib codec (it imports lib modules back, which would create a cycle).
import type {
  AttachmentCheckpoint,
  AttachmentImageIntent,
  AttachmentItem,
  AttachmentKind,
  AttachmentStatus,
  AttachmentTransferPhase,
  CompressionReason,
} from "../features/session/attachments/attach-model";

export const ATTACHMENT_JOURNAL_VERSION = 1 as const;

const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 256;
const MAX_MIME_LENGTH = 128;
const MAX_TEXT_LENGTH = 4096;
const MAX_PATH_LENGTH = 4096;

/** A pre-Begin queued row may keep up to the 40 MiB intake ceiling. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_UPLOAD_BYTES_PRE_CHECKPOINT = 40 * 1024 * 1024;

const OCTET_STREAM = "application/octet-stream";

const ITEM_KINDS: ReadonlySet<string> = new Set(["image", "file"]);
const ITEM_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "preparing",
  "uploading",
  "cancelling",
  "committed",
  "error",
  "cancelled",
]);
const COMPRESSION_REASONS: ReadonlySet<string> = new Set([
  "compressed",
  "small",
  "preserved",
  "unsupported",
  "not-smaller",
  "failed",
]);
const IMAGE_INTENTS: ReadonlySet<string> = new Set(["photo", "detail"]);
const TRANSFER_PHASES: ReadonlySet<string> = new Set([
  "queued",
  "compressing",
  "hashing",
  "begin",
  "sending",
  "commit",
  "status",
]);
/** stageTimings accepts exactly these elapsed-ms keys; any other key drops. */
const STAGE_TIMING_KEYS: ReadonlySet<string> = new Set([
  "compression",
  "hashing",
  "begin",
  "sending",
  "commit",
  "status",
]);

/** The live record handed to and returned by the codec. */
export type AttachmentJournalRecord = {
  version: 1;
  daemonId: string;
  paneId: string;
  localId: string;
  updatedAt: number;
  /** Editable source; the image editor opens this, never the upload file. */
  sourceFile: File;
  /** File actually uploaded: the source, or a prepared/compressed image. */
  uploadFile: File;
  item: AttachmentItem;
  checkpoint?: AttachmentCheckpoint;
};

/** One stored file: the bytes stay inside the Blob, metadata rides beside it. */
export type StoredFileBlob = {
  readonly blob: Blob;
  readonly name: string;
  readonly type: string;
  readonly lastModified: number;
};

/** Structured-cloneable record (IndexedDB-ready, but this module does no I/O). */
export type StoredAttachmentRecord = {
  readonly version: 1;
  readonly key: readonly [daemonId: string, paneId: string, localId: string];
  readonly updatedAt: number;
  /** Upload bytes are the source bytes: upload.blob shares source.blob. */
  readonly sameFile: boolean;
  readonly source: StoredFileBlob;
  readonly upload: StoredFileBlob;
  readonly item: AttachmentItem;
  readonly checkpoint?: AttachmentCheckpoint;
};

type UploadMeta = {
  readonly name: string;
  readonly size: number;
  readonly type: string;
};

function invalid(reason: string): never {
  throw new Error(`invalid attachment journal record: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsNul(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) === 0) return true;
  }
  return false;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Identity tuple member: non-empty, <= 256, no NUL. */
function validId(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ID_LENGTH
    && !containsNul(value)
  );
}

/** Validate a journal identity string (non-empty, <= 256, no NUL). */
export function validateJournalId(value: unknown, label: string): string {
  if (!validId(value)) invalid(label);
  return value;
}

/** File name: non-empty, <= 256, no control characters (mirrors transfer). */
function validFileName(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= MAX_NAME_LENGTH
    && !hasControlChar(value)
  );
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function nonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Elapsed-ms timing: finite and non-negative (fractional ms allowed). */
function finiteNonNeg(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Pixel dimensions, when known, are positive integers. */
function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** MIME the upload RPC normalizes an empty File.type to. */
function normalizedMime(type: string): string {
  return type.length > 0 ? type : OCTET_STREAM;
}

function filePartFromLive(file: unknown, label: string, maxBytes: number): StoredFileBlob {
  if (typeof File === "undefined" || !(file instanceof File)) invalid(`${label} is not a File`);
  const { name, lastModified } = file;
  const type = file.type ?? "";
  if (!validFileName(name)) invalid(`${label}.name`);
  if (!boundedString(type, MAX_MIME_LENGTH)) invalid(`${label}.type`);
  if (typeof lastModified !== "number" || !Number.isFinite(lastModified)) invalid(`${label}.lastModified`);
  if (!nonNegInt(file.size)) invalid(`${label}.size`);
  if (file.size > maxBytes) invalid(`${label} exceeds ${maxBytes} bytes`);
  return { blob: file, name, type, lastModified };
}

function filePartFromStored(raw: unknown, label: string, maxBytes: number): StoredFileBlob {
  if (!isRecord(raw)) invalid(`${label} is not an object`);
  const { blob, name, type, lastModified } = raw;
  if (typeof Blob === "undefined" || !(blob instanceof Blob)) invalid(`${label}.blob is not a Blob`);
  if (!validFileName(name)) invalid(`${label}.name`);
  if (!boundedString(type, MAX_MIME_LENGTH)) invalid(`${label}.type`);
  if (typeof lastModified !== "number" || !Number.isFinite(lastModified)) invalid(`${label}.lastModified`);
  if (!nonNegInt(blob.size)) invalid(`${label}.size`);
  if (blob.size > maxBytes) invalid(`${label} exceeds ${maxBytes} bytes`);
  return { blob, name, type, lastModified };
}

function asEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>, label: string): T {
  if (typeof value !== "string" || !allowed.has(value)) invalid(label);
  return value as T;
}

/**
 * Validate an AttachmentItem and return a fresh copy containing ONLY known
 * fields. Unknown keys are dropped, so foreign/forward-compatible fields can
 * never round-trip into the running queue. name/size/mime must describe the
 * upload File exactly.
 */
function sanitizeItem(raw: unknown, localId: string, upload: UploadMeta): AttachmentItem {
  if (!isRecord(raw)) invalid("item is not an object");

  if (!validId(raw.localId) || raw.localId !== localId) invalid("item.localId");
  const kind = asEnum<AttachmentKind>(raw.kind, ITEM_KINDS, "item.kind");
  if (!validFileName(raw.name) || raw.name !== upload.name) invalid("item.name");
  if (!nonNegInt(raw.size) || raw.size !== upload.size) invalid("item.size");
  if (!boundedString(raw.mime, MAX_MIME_LENGTH) || raw.mime !== (upload.type ?? "")) {
    invalid("item.mime");
  }
  const status = asEnum<AttachmentStatus>(raw.status, ITEM_STATUSES, "item.status");
  if (!nonNegInt(raw.acknowledged) || raw.acknowledged > raw.size) invalid("item.acknowledged");
  if (!boundedString(raw.errorText, MAX_TEXT_LENGTH)) invalid("item.errorText");
  if (typeof raw.recoverable !== "boolean") invalid("item.recoverable");
  if (!boundedString(raw.path, MAX_PATH_LENGTH) || raw.path.includes("\\")) invalid("item.path");
  if (raw.path.length > 0 && (!raw.path.startsWith("/") || hasControlChar(raw.path))) {
    invalid("item.path");
  }
  if (typeof raw.inserted !== "boolean") invalid("item.inserted");
  if (!boundedString(raw.editNote, MAX_TEXT_LENGTH)) invalid("item.editNote");
  if (typeof raw.cancelIntent !== "boolean") invalid("item.cancelIntent");
  // A committed row is fully acknowledged with a usable absolute path.
  if (status === "committed" && (raw.acknowledged !== raw.size || raw.path === "")) {
    invalid("committed item");
  }

  const item: AttachmentItem = {
    localId: raw.localId,
    kind,
    name: raw.name,
    size: raw.size,
    mime: raw.mime,
    status,
    acknowledged: raw.acknowledged,
    errorText: raw.errorText,
    recoverable: raw.recoverable,
    path: raw.path,
    inserted: raw.inserted,
    editNote: raw.editNote,
    cancelIntent: raw.cancelIntent,
  };

  if (raw.speedBps !== undefined) {
    if (!finitePositive(raw.speedBps)) invalid("item.speedBps");
    item.speedBps = raw.speedBps;
  }
  if (raw.etaSeconds !== undefined) {
    // ETA exists only together with a real measured rate.
    if (!finitePositive(raw.etaSeconds) || item.speedBps === undefined) invalid("item.etaSeconds");
    item.etaSeconds = raw.etaSeconds;
  }
  if (raw.waiting !== undefined) {
    if (typeof raw.waiting !== "boolean") invalid("item.waiting");
    item.waiting = raw.waiting;
  }
  if (raw.compressionMode !== undefined) {
    if (raw.compressionMode !== "smart" && raw.compressionMode !== "original") invalid("item.compressionMode");
    item.compressionMode = raw.compressionMode;
  }
  if (raw.compressing !== undefined) {
    if (typeof raw.compressing !== "boolean") invalid("item.compressing");
    item.compressing = raw.compressing;
  }
  if (raw.originalBytes !== undefined) {
    // Source bytes are always >= the (possibly compressed) upload bytes.
    if (!nonNegInt(raw.originalBytes) || raw.originalBytes < item.size) invalid("item.originalBytes");
    item.originalBytes = raw.originalBytes;
  }
  if (raw.compressionReason !== undefined) {
    item.compressionReason = asEnum<CompressionReason>(
      raw.compressionReason,
      COMPRESSION_REASONS,
      "item.compressionReason",
    );
  }
  if (raw.compressionChanged !== undefined) {
    if (typeof raw.compressionChanged !== "boolean") invalid("item.compressionChanged");
    item.compressionChanged = raw.compressionChanged;
  }
  // Known current-generation optional fields. They are preserved exactly as
  // stored — a restored 'detail' intent is never defaulted back to 'photo' —
  // but every value is still type-checked; foreign keys stay dropped.
  if (raw.imageIntent !== undefined) {
    item.imageIntent = asEnum<AttachmentImageIntent>(raw.imageIntent, IMAGE_INTENTS, "item.imageIntent");
  }
  if (raw.scheduled !== undefined) {
    if (typeof raw.scheduled !== "boolean") invalid("item.scheduled");
    item.scheduled = raw.scheduled;
  }
  if (raw.transferPhase !== undefined) {
    item.transferPhase = asEnum<AttachmentTransferPhase>(raw.transferPhase, TRANSFER_PHASES, "item.transferPhase");
  }
  if (raw.stageTimings !== undefined) {
    if (!isRecord(raw.stageTimings)) invalid("item.stageTimings");
    const timings: Record<string, number> = {};
    for (const [stage, ms] of Object.entries(raw.stageTimings)) {
      if (!STAGE_TIMING_KEYS.has(stage)) continue; // drop unknown stage, keep rest
      if (!finiteNonNeg(ms)) invalid("item.stageTimings");
      timings[stage] = ms;
    }
    item.stageTimings = timings as AttachmentItem["stageTimings"];
  }
  if (raw.persistenceWarning !== undefined) {
    if (!boundedString(raw.persistenceWarning, MAX_TEXT_LENGTH)) invalid("item.persistenceWarning");
    item.persistenceWarning = raw.persistenceWarning;
  }
  if (raw.restored !== undefined) {
    if (typeof raw.restored !== "boolean") invalid("item.restored");
    item.restored = raw.restored;
  }
  if (raw.outputWidth !== undefined) {
    if (!positiveInt(raw.outputWidth)) invalid("item.outputWidth");
    item.outputWidth = raw.outputWidth;
  }
  if (raw.outputHeight !== undefined) {
    if (!positiveInt(raw.outputHeight)) invalid("item.outputHeight");
    item.outputHeight = raw.outputHeight;
  }

  return item;
}

/**
 * Re-validate a whitelisted checkpoint copy with the existing transfer
 * validator, then bind it to this record: pane/name/size and normalized mime
 * must describe the upload File. Unknown checkpoint keys are dropped.
 */
function sanitizeCheckpoint(raw: unknown, paneId: string, upload: UploadMeta): AttachmentCheckpoint {
  if (!isRecord(raw)) invalid("checkpoint is not an object");
  // Anything but absent or exactly 2 is a corrupt/foreign checkpoint.
  const version = raw.version === undefined ? undefined : raw.version === 2 ? 2 : invalid("checkpoint.version");
  const checkpoint: AttachmentCheckpoint = {
    uploadId: raw.uploadId as string,
    paneId: raw.paneId as string,
    name: raw.name as string,
    size: raw.size as number,
    sha256: raw.sha256 as string,
    mime: raw.mime as string,
  };
  if (version === 2) checkpoint.version = 2;
  // Existing canonical validator (throws ProtocolError on bad shape).
  validateAttachmentCheckpoint(checkpoint);
  if (checkpoint.paneId !== paneId) invalid("checkpoint.paneId");
  if (checkpoint.name !== upload.name) invalid("checkpoint.name");
  if (checkpoint.size !== upload.size) invalid("checkpoint.size");
  if (checkpoint.mime !== normalizedMime(upload.type)) invalid("checkpoint.mime");
  return checkpoint;
}

function validateUpdatedAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid("updatedAt");
  return value;
}

/**
 * Validate a live record and produce its stored shape. Blob references are
 * kept as-is — bytes are never read. When source and upload are the same File
 * object, one Blob is shared between both stored parts.
 */
export function encodeAttachmentRecord(input: AttachmentJournalRecord): StoredAttachmentRecord {
  if (!isRecord(input)) invalid("input is not an object");
  if (input.version !== ATTACHMENT_JOURNAL_VERSION) invalid("version");

  const { daemonId, paneId, localId } = input;
  if (!validId(daemonId)) invalid("daemonId");
  if (!validId(paneId)) invalid("paneId");
  if (!validId(localId)) invalid("localId");
  const updatedAt = validateUpdatedAt(input.updatedAt);

  const hasCheckpoint = input.checkpoint !== undefined;
  const uploadLimit = hasCheckpoint ? ATTACHMENT_MAX_FILE_BYTES : MAX_UPLOAD_BYTES_PRE_CHECKPOINT;
  if (typeof File === "undefined"
    || !(input.sourceFile instanceof File)
    || !(input.uploadFile instanceof File)) {
    invalid("sourceFile/uploadFile must be File instances");
  }
  const sameFile = input.uploadFile === input.sourceFile;

  const source = filePartFromLive(input.sourceFile, "sourceFile", MAX_SOURCE_BYTES);
  const uploadPart = filePartFromLive(input.uploadFile, "uploadFile", uploadLimit);
  // Share one Blob identity so the bytes are counted/stored once.
  const upload: StoredFileBlob = sameFile
    ? { blob: source.blob, name: uploadPart.name, type: uploadPart.type, lastModified: uploadPart.lastModified }
    : uploadPart;

  const uploadMeta: UploadMeta = { name: upload.name, size: upload.blob.size, type: upload.type };
  const item = sanitizeItem(input.item, localId, uploadMeta);
  const checkpoint = hasCheckpoint
    ? sanitizeCheckpoint(input.checkpoint, paneId, uploadMeta)
    : undefined;
  const stored: StoredAttachmentRecord = {
    version: ATTACHMENT_JOURNAL_VERSION,
    key: [daemonId, paneId, localId],
    updatedAt,
    sameFile,
    source,
    upload,
    item,
    ...(checkpoint ? { checkpoint } : {}),
  };
  return stored;
}

function reconstructFile(part: StoredFileBlob): File {
  return new File([part.blob], part.name, { type: part.type, lastModified: part.lastModified });
}

function decodeStored(stored: unknown): AttachmentJournalRecord {
  if (!isRecord(stored)) invalid("stored is not an object");
  if (stored.version !== ATTACHMENT_JOURNAL_VERSION) invalid("version");

  const { key } = stored;
  if (!Array.isArray(key) || key.length !== 3) invalid("key");
  const [daemonId, paneId, localId] = key;
  if (!validId(daemonId)) invalid("key.daemonId");
  if (!validId(paneId)) invalid("key.paneId");
  if (!validId(localId)) invalid("key.localId");
  const updatedAt = validateUpdatedAt(stored.updatedAt);

  if (typeof stored.sameFile !== "boolean") invalid("sameFile");
  const hasCheckpoint = stored.checkpoint !== undefined;
  const uploadLimit = hasCheckpoint ? ATTACHMENT_MAX_FILE_BYTES : MAX_UPLOAD_BYTES_PRE_CHECKPOINT;
  const source = filePartFromStored(stored.source, "source", MAX_SOURCE_BYTES);
  const upload = filePartFromStored(stored.upload, "upload", uploadLimit);
  if (stored.sameFile) {
    // sameFile is an ALIAS claim: both parts must reference the exact same
    // Blob object. Equal metadata is not enough — two different files can
    // share name/type/size while holding different bytes. Structured clone
    // (including the IndexedDB round-trip) preserves same-reference aliases,
    // so identity surviving the trip is expected; a flag whose blobs are not
    // identical is corrupt data: reject instead of swapping the upload bytes.
    if (
      source.blob !== upload.blob
      || source.name !== upload.name
      || source.type !== upload.type
      || source.lastModified !== upload.lastModified
    ) {
      invalid("sameFile flag without shared blob alias");
    }
  }

  const uploadMeta: UploadMeta = { name: upload.name, size: upload.blob.size, type: upload.type };
  const item = sanitizeItem(stored.item, localId, uploadMeta);
  const checkpoint = hasCheckpoint
    ? sanitizeCheckpoint(stored.checkpoint, paneId, uploadMeta)
    : undefined;

  // The upload File is ALWAYS rebuilt from the upload blob — it is never
  // substituted from the source just because sameFile was set or metadata
  // matches. When the alias was verified above one reconstructed File backs
  // both fields; otherwise source and upload are two independent Files.
  const uploadFile = reconstructFile(upload);
  const sourceFile = stored.sameFile ? uploadFile : reconstructFile(source);

  const record: AttachmentJournalRecord = {
    version: ATTACHMENT_JOURNAL_VERSION,
    daemonId,
    paneId,
    localId,
    updatedAt,
    sourceFile,
    uploadFile,
    item,
  };
  if (checkpoint) record.checkpoint = checkpoint;
  return record;
}

/** Read back a stored record, or null when any part fails validation. */
export function decodeAttachmentRecord(stored: unknown): AttachmentJournalRecord | null {
  try {
    return decodeStored(stored);
  } catch {
    return null;
  }
}

/**
 * Bytes held by one stored record. The shared file is counted once ONLY when
 * the sameFile flag is backed by a verified blob alias; every other shape —
 * including a flag without alias identity (corrupt) — counts both blobs.
 * Pure arithmetic over Blob sizes; the bytes themselves are not read.
 */
export function attachmentRecordBytes(stored: StoredAttachmentRecord): number {
  const sharedOnce = stored.sameFile === true && stored.source.blob === stored.upload.blob;
  return stored.source.blob.size + (sharedOnce ? 0 : stored.upload.blob.size);
}
