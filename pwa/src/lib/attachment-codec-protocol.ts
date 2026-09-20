/**
 * Wire types between the attachment codec API and its one-shot module worker.
 *
 * Narrow by contract: exactly two discriminated operations, one job id per
 * request, one reply per job. A `File` crosses by structured clone (never an
 * ArrayBuffer). The worker returns strings only; it never sends file bytes,
 * paths, logs or diagnostics back. This module holds types plus structural
 * validation used on BOTH sides — no DOM-app imports.
 */

export const CODEC_OP_SHA256 = "sha256" as const;
export const CODEC_OP_B64CHUNK = "b64chunk" as const;
export type CodecOp = typeof CODEC_OP_SHA256 | typeof CODEC_OP_B64CHUNK;

export type CodecSha256Request = {
  readonly jobId: string;
  readonly op: typeof CODEC_OP_SHA256;
  readonly file: File;
};

export type CodecB64ChunkRequest = {
  readonly jobId: string;
  readonly op: typeof CODEC_OP_B64CHUNK;
  readonly file: File;
  /** Inclusive byte start; the slice is [offset, end). */
  readonly offset: number;
  readonly end: number;
};

export type CodecRequest = CodecSha256Request | CodecB64ChunkRequest;

export type CodecReplyOk = {
  readonly jobId: string;
  readonly op: CodecOp;
  readonly ok: true;
  /** Hex digest for sha256; canonical standard base64 for b64chunk ("" for 0 bytes). */
  readonly result: string;
};

export type CodecReplyError = {
  readonly jobId: string;
  /** Echoes the request op when the request was readable, otherwise null. */
  readonly op: CodecOp | null;
  readonly ok: false;
  readonly error: { readonly name: string; readonly message: string };
};

export type CodecReply = CodecReplyOk | CodecReplyError;

const HEX64 = /^[0-9a-f]{64}$/u;
const CANONICAL_B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const STANDARD_B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const PAD_COUNT_PROBLEM = "base64 padding does not match byte count";
const PAD_BITS_PROBLEM = "base64 padding bits are not zero";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFileLike(value: unknown): value is File {
  if (!isRecord(value)) return false;
  return typeof value.size === "number"
    && typeof value.slice === "function"
    && typeof value.arrayBuffer === "function";
}

/** Structural request check the worker runs on every posted message. */
export function isCodecRequest(value: unknown): value is CodecRequest {
  if (!isRecord(value) || typeof value.jobId !== "string" || value.jobId === "" || !isFileLike(value.file)) {
    return false;
  }
  if (value.op === CODEC_OP_SHA256) return true;
  if (value.op === CODEC_OP_B64CHUNK) {
    return Number.isSafeInteger(value.offset) && Number.isSafeInteger(value.end)
      && typeof value.offset === "number" && typeof value.end === "number";
  }
  return false;
}

function expectedBase64Length(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

/**
 * The 4-character terminal quad carries padding. Its padding character count
 * must match byteLength mod 3 exactly (otherwise the string decodes to a
 * different number of bytes), and the unused low bits of its final data
 * character must be zero (otherwise the encoding is not canonical even
 * though it decodes).
 *
 * rem 1: `XX==`, the second char's low 4 bits must be zero;
 * rem 2: `XXX=`, the third char's low 2 bits must be zero;
 * rem 0: no padding at all.
 *
 * Suffix + one alphabet lookup only — never a whole-buffer decode/re-encode.
 * The shape regex above has already excluded interior padding and bad chars.
 */
function base64PaddingProblem(result: string, byteLength: number): string | null {
  const remainder = byteLength % 3;
  if (remainder === 0) return result.includes("=") ? PAD_COUNT_PROBLEM : null;
  const tail = result.slice(-4);
  if (remainder === 1) {
    if (tail[2] !== "=" || tail[3] !== "=") return PAD_COUNT_PROBLEM;
    const value = STANDARD_B64_ALPHABET.indexOf(tail[1]);
    if (value < 0) return "base64 result not canonical";
    return (value & 0b1111) !== 0 ? PAD_BITS_PROBLEM : null;
  }
  // remainder === 2: exactly one trailing '=' and a data char before it.
  if (tail[2] === "=" || tail[3] !== "=") return PAD_COUNT_PROBLEM;
  const value = STANDARD_B64_ALPHABET.indexOf(tail[2]);
  if (value < 0) return "base64 result not canonical";
  return (value & 0b11) !== 0 ? PAD_BITS_PROBLEM : null;
}

/**
 * Validate a worker reply against the request it answers. Returns null when
 * the reply is well formed and matches, otherwise a short English reason for
 * the API side to turn into an actionable error. Never trusts `ok` alone.
 */
export function validateCodecReply(
  reply: unknown,
  request: CodecRequest,
  byteLength: number,
): string | null {
  if (!isRecord(reply)) return "reply was not an object";
  if (reply.jobId !== request.jobId) return "reply job id mismatch";
  if (reply.op !== request.op) return "reply op mismatch";
  if (typeof reply.ok !== "boolean") return "reply ok flag missing";
  if (reply.ok) {
    if (typeof reply.result !== "string") return "reply result was not a string";
    const result = reply.result;
    if (request.op === CODEC_OP_SHA256) {
      return HEX64.test(result) ? null : "sha256 result malformed";
    }
    if (result.length !== expectedBase64Length(byteLength)) return "base64 result length mismatch";
    if (byteLength === 0) return null; // the length check above proved result === ""
    if (!CANONICAL_B64.test(result)) return "base64 result not canonical";
    return base64PaddingProblem(result, byteLength);
  }
  if (!isRecord(reply.error) || typeof reply.error.message !== "string") {
    return "error reply missing a message";
  }
  return null;
}

export function codecErrorReply(request: Pick<CodecRequest, "jobId" | "op">, error: unknown): CodecReplyError {
  return {
    jobId: request.jobId,
    op: request.op,
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : "worker failed",
    },
  };
}

/** Best-effort reply for a message the worker could not even read as a request. */
export function codecUnreadableReply(data: unknown): CodecReplyError {
  const jobId = isRecord(data) && typeof data.jobId === "string" ? data.jobId : "";
  const op = isRecord(data) && (data.op === CODEC_OP_SHA256 || data.op === CODEC_OP_B64CHUNK)
    ? data.op as CodecOp
    : null;
  return { jobId, op, ok: false, error: { name: "Error", message: "malformed codec request" } };
}

export function isCodecOkReply(reply: CodecReply): reply is CodecReplyOk {
  return reply.ok;
}
