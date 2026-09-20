/**
 * CPU side of attachment hashing and chunk encoding, shared by the module
 * worker and by the main-thread cooperative fallback so both produce byte
 * identical results.
 *
 * Rules (P4):
 * - SHA-256 runs incrementally over bounded 256 KiB slices; the whole file is
 *   never held in memory and the original File bytes are never modified;
 * - encoding reads at most one 128 KiB slice; the base64 CPU work is split at
 *   3-byte-aligned subchunk boundaries with a task yield between pieces, so
 *   concatenated pieces stay exactly canonical (only the final piece pads);
 * - abort is checked before and after every read and every yield;
 * - a File read failure surfaces to the caller. There is no retry here.
 *
 * No Worker/DOM-app imports: File/Blob and setTimeout are host built-ins.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { base64Encode, bytesToHex } from "./protocol/bytes.ts";

export const CODEC_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const CODEC_MAX_CHUNK_BYTES = 128 * 1024;
export const CODEC_HASH_SLICE_BYTES = 256 * 1024;
/** 49152 = 16384 * 3: every non-final base64 piece stays padding-free. */
export const CODEC_ENCODE_SUBCHUNK_BYTES = 48 * 1024;

export function codecAbortError(): DOMException {
  return new DOMException("附件处理已取消", "AbortError");
}

export function checkCodecAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw codecAbortError();
}

/** Yield the thread, honouring abort on both sides of the tick. */
async function yieldTick(signal?: AbortSignal): Promise<void> {
  checkCodecAbort(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkCodecAbort(signal);
}

export function validateCodecFile(file: File): void {
  if (!file || typeof file.size !== "number" || typeof file.slice !== "function") {
    throw new TypeError("附件不是可读文件");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new TypeError("附件大小非法");
  }
  if (file.size > CODEC_MAX_FILE_BYTES) {
    throw new TypeError("单个附件不能超过 20 MiB");
  }
}

/** 0 <= offset <= end <= file.size, end - offset <= 128 KiB, all safe ints. */
export function validateCodecRange(file: File, offset: number, end: number): number {
  validateCodecFile(file);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end)) {
    throw new RangeError("分片范围必须是安全整数");
  }
  if (offset < 0 || end < offset || end > file.size) {
    throw new RangeError("分片范围越界");
  }
  const length = end - offset;
  if (length > CODEC_MAX_CHUNK_BYTES) {
    throw new RangeError("分片不能超过 128 KiB");
  }
  return length;
}

/**
 * Incremental SHA-256 of the whole file (lowercase hex). Empty files are
 * supported: zero slices still return the digest of the empty input.
 */
export async function hashFileCore(file: File, signal?: AbortSignal): Promise<string> {
  validateCodecFile(file);
  checkCodecAbort(signal);
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += CODEC_HASH_SLICE_BYTES) {
    checkCodecAbort(signal);
    const sliceEnd = Math.min(offset + CODEC_HASH_SLICE_BYTES, file.size);
    const buffer = await file.slice(offset, sliceEnd).arrayBuffer();
    checkCodecAbort(signal); // a post-read abort must not feed the hasher
    hash.update(new Uint8Array(buffer));
    if (sliceEnd < file.size) await yieldTick(signal);
  }
  checkCodecAbort(signal);
  return bytesToHex(hash.digest());
}

/**
 * Canonical standard-alphabet base64 of file bytes [offset, end). One bounded
 * read; the CPU encode proceeds in aligned subchunks so the joined string is
 * identical to encoding the whole slice at once. Empty ranges return "".
 */
export async function encodeChunkCore(
  file: File,
  offset: number,
  end: number,
  signal?: AbortSignal,
): Promise<string> {
  const length = validateCodecRange(file, offset, end);
  checkCodecAbort(signal);
  if (length === 0) return "";
  const buffer = await file.slice(offset, end).arrayBuffer();
  checkCodecAbort(signal);
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  for (let pos = 0; pos < length; pos += CODEC_ENCODE_SUBCHUNK_BYTES) {
    checkCodecAbort(signal);
    const pieceEnd = Math.min(pos + CODEC_ENCODE_SUBCHUNK_BYTES, length);
    // pos is always a multiple of 3 (49152), so every piece except the final
    // one encodes a triplet-aligned tail and contributes no "=" padding.
    parts.push(base64Encode(bytes.subarray(pos, pieceEnd)));
    if (pieceEnd < length) await yieldTick(signal);
  }
  checkCodecAbort(signal);
  return parts.join("");
}
