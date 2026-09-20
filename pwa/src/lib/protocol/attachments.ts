// Workspace upload (attachment) RPC result types and strict parsers.
// Wire contract: proto/workspace-upload.md. UploadState has EXACT keys,
// sha256 is lower-case 64-hex, chunk_bytes is exactly 32 KiB, committed
// offset must equal size, and committed paths must be absolute and free of
// control characters.
import { ProtocolError } from "./errors.ts";

export const ATTACHMENT_UPLOAD_CHUNK_BYTES = 32_768;
export const ATTACHMENT_UPLOAD_CHUNK_BYTES_V2 = 131_072;

export type UploadBeginInput = {
  pane_id: string;
  upload_id: string;
  name: string;
  size: number;
  sha256: string;
  mime: string;
};

export type UploadWriteInput = {
  pane_id: string;
  upload_id: string;
  offset: number;
  data_b64: string;
};

export type UploadStateActive = {
  upload_id: string;
  state: "uploading" | "cancelled";
  offset: number;
  size: number;
  sha256: string;
  chunk_bytes: number;
};

export type UploadStateCommitted = {
  upload_id: string;
  state: "committed";
  offset: number;
  size: number;
  sha256: string;
  chunk_bytes: number;
  path: string;
  relative_path: string;
  name: string;
  mime: string;
};

export type UploadState = UploadStateActive | UploadStateCommitted;

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const MIME = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}$/u;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;

const BASE_KEYS = ["upload_id", "state", "offset", "size", "sha256", "chunk_bytes"];
const COMMITTED_KEYS = [...BASE_KEYS, "path", "relative_path", "name", "mime"];

export function validUploadID(value: string): boolean {
  return UPLOAD_ID.test(value);
}

export function validAttachmentDigest(value: string): boolean {
  return SHA256_HEX.test(value);
}

function invalid(label: string): never {
  throw new ProtocolError("bad_message", `${label} 响应格式不正确`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}

function exactKeys(result: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(result).sort();
  const wanted = [...keys].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid(label);
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL_CHARS.test(value)) invalid(label);
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(label);
  return value as number;
}

/** Strict UploadState parser; committed states must additionally carry a safe absolute path. */
export function parseUploadState(value: unknown, expectedUploadID?: string): UploadState {
  return parseUploadStateAt(value, expectedUploadID, ATTACHMENT_UPLOAD_CHUNK_BYTES);
}

/**
 * Strict V2 UploadState parser. Same key set and checks as {@link parseUploadState},
 * but chunk_bytes must be exactly 131072 (ATTACHMENT_UPLOAD_CHUNK_BYTES_V2).
 * The legacy parser stays pinned to 32768 and is never relaxed.
 */
export function parseUploadStateV2(value: unknown, expectedUploadID?: string): UploadState {
  return parseUploadStateAt(value, expectedUploadID, ATTACHMENT_UPLOAD_CHUNK_BYTES_V2);
}

function parseUploadStateAt(value: unknown, expectedUploadID: string | undefined, chunkBytes: number): UploadState {
  const label = "WorkspaceUpload";
  const result = record(value, label);
  const state = result.state;
  if (state !== "uploading" && state !== "committed" && state !== "cancelled") invalid(`${label}.state`);
  exactKeys(result, state === "committed" ? COMMITTED_KEYS : BASE_KEYS, label);

  const upload_id = text(result.upload_id, `${label}.upload_id`, 36);
  if (!UPLOAD_ID.test(upload_id) || upload_id.length !== 36) invalid(`${label}.upload_id`);
  if (expectedUploadID !== undefined && upload_id !== expectedUploadID) {
    throw new ProtocolError("bad_message", `${label} 响应 upload_id 不匹配`);
  }
  const sha256 = text(result.sha256, `${label}.sha256`, 64);
  if (!SHA256_HEX.test(sha256)) invalid(`${label}.sha256`);
  const size = integer(result.size, `${label}.size`, 0, Number.MAX_SAFE_INTEGER);
  const offset = integer(result.offset, `${label}.offset`, 0, size);
  const chunk_bytes = integer(result.chunk_bytes, `${label}.chunk_bytes`, chunkBytes, chunkBytes);

  if (state !== "committed") return { upload_id, state, offset, size, sha256, chunk_bytes };

  // A committed upload is published only after full length verification.
  if (offset !== size) invalid(`${label}.offset`);

  const path = text(result.path, `${label}.path`, 4096);
  if (!path.startsWith("/") || path.split("/").some((part) => part === "..")) invalid(`${label}.path`);
  const relative_path = text(result.relative_path, `${label}.relative_path`, 4096);
  if (relative_path.startsWith("/") || relative_path.startsWith("\\") || relative_path.split(/[\\/]/u).some((part) => part === "..")) {
    invalid(`${label}.relative_path`);
  }
  const name = text(result.name, `${label}.name`, 256);
  const mime = text(result.mime, `${label}.mime`, 128);
  if (!MIME.test(mime)) invalid(`${label}.mime`);
  return { upload_id, state, offset, size, sha256, chunk_bytes, path, relative_path, name, mime };
}
