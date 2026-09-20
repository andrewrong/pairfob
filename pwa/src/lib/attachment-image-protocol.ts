/**
 * Wire types between the attachment image host API and its module worker.
 *
 * One job id per request, one reply per job; a `File` crosses by structured
 * clone. The worker returns at most one compressed `Blob` (only for
 * `compressed`), plus brief metadata. This module holds types plus structural
 * validation used on BOTH sides — no DOM-app / drawing imports.
 */
import {
  MAX_OUTPUT_DIMENSION,
  MIN_SAVING_RATIO,
  THUMBNAIL_MAX_OUTPUT_BYTES,
  THUMBNAIL_MAX_OUTPUT_DIMENSION,
} from "./attachment-image-policy.ts";

/** Discriminator for the shared worker queue. */
export type ImageTaskKind = "image" | "thumbnail";

export type ImageWorkerRequest = {
  readonly jobId: string;
  readonly file: File;
  /**
   * Trusted edited PNG originally sourced from a JPEG (explicit, never
   * sniffed). Provenance for the image task only; thumbnails send false.
   */
  readonly photo: boolean;
  /**
   * Selects the worker path. Absent / "image" keeps older requests and the
   * existing tests compatible; "thumbnail" runs the bounded thumb path.
   */
  readonly task?: ImageTaskKind;
};

export type ImageWorkerReply =
  | {
      readonly jobId: string;
      readonly ok: true;
      readonly kind: "compressed";
      readonly blob: Blob;
      readonly mime: string;
      readonly name: string;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly jobId: string;
      readonly ok: true;
      readonly kind: "thumbnail";
      readonly blob: Blob;
      readonly mime: "image/jpeg" | "image/png";
      readonly width: number;
      readonly height: number;
    }
  | { readonly jobId: string; readonly ok: true; readonly kind: "preserved" }
  | { readonly jobId: string; readonly ok: true; readonly kind: "unsupported" }
  | { readonly jobId: string; readonly ok: true; readonly kind: "not-smaller" }
  | { readonly jobId: string; readonly ok: true; readonly kind: "failed" }
  | {
      readonly jobId: string;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string };
    };

const SIMPLE_OK_KINDS = new Set(["preserved", "unsupported", "not-smaller", "failed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFileLike(value: unknown): value is File {
  return isRecord(value)
    && typeof value.size === "number"
    && typeof value.slice === "function"
    && typeof value.arrayBuffer === "function";
}

/** Structural request check the worker runs on every posted message. */
export function isImageRequest(value: unknown): value is ImageWorkerRequest {
  return isRecord(value)
    && typeof value.jobId === "string"
    && value.jobId !== ""
    && isFileLike(value.file)
    && typeof value.photo === "boolean"
    && (value.task === undefined || value.task === "image" || value.task === "thumbnail");
}

function isBlob(value: unknown): value is Blob {
  // A real Blob is required — duck-typed plain objects are rejected.
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Validate a worker reply against the request it answers and the input size,
 * returning a short reason string when it is malformed or violates bounds
 * (never trusted on `ok`/kind alone). The host maps any non-null problem to a
 * fail-closed original fallback.
 */
export function validateImageReply(
  reply: unknown,
  request: ImageWorkerRequest,
  inputSize: number,
): string | null {
  if (!isRecord(reply)) return "reply was not an object";
  if (reply.jobId !== request.jobId) return "reply job id mismatch";
  if (typeof reply.ok !== "boolean") return "reply ok flag missing";
  if (!reply.ok) {
    if (!isRecord(reply.error) || typeof reply.error.message !== "string") {
      return "error reply missing a message";
    }
    return null;
  }
  const kind = reply.kind;
  if (kind === "compressed") {
    if (!isBlob(reply.blob)) return "compressed reply blob is not a real Blob";
    if (reply.mime !== "image/jpeg") return "compressed reply MIME is not image/jpeg";
    if (reply.blob.type !== "image/jpeg") return "compressed reply blob type is not image/jpeg";
    if (typeof reply.name !== "string" || reply.name === "") return "compressed reply name invalid";
    if (!isPositiveInt(reply.width) || !isPositiveInt(reply.height)) return "compressed reply dims invalid";
    if (reply.width > MAX_OUTPUT_DIMENSION || reply.height > MAX_OUTPUT_DIMENSION) {
      return "compressed reply dims exceed max output";
    }
    if (reply.blob.size <= 0) return "compressed reply blob empty";
    if (reply.blob.size > inputSize) return "compressed reply bigger than input";
    if (reply.blob.size > inputSize * (1 - MIN_SAVING_RATIO)) return "compressed reply insufficient gain";
    return null;
  }
  if (kind === "thumbnail") {
    if (!isBlob(reply.blob)) return "thumbnail reply blob is not a real Blob";
    if (reply.mime !== "image/jpeg" && reply.mime !== "image/png") {
      return "thumbnail reply MIME unsupported";
    }
    if (reply.blob.type !== reply.mime) return "thumbnail reply blob type mismatch";
    if (!isPositiveInt(reply.width) || !isPositiveInt(reply.height)) return "thumbnail reply dims invalid";
    if (
      reply.width > THUMBNAIL_MAX_OUTPUT_DIMENSION ||
      reply.height > THUMBNAIL_MAX_OUTPUT_DIMENSION
    ) {
      return "thumbnail reply dims exceed 128";
    }
    if (reply.blob.size <= 0) return "thumbnail reply blob empty";
    if (reply.blob.size > THUMBNAIL_MAX_OUTPUT_BYTES) return "thumbnail reply blob exceeds 128 KiB";
    // Byte signature vs MIME is checked asynchronously on the host.
    return null;
  }
  if (typeof kind === "string" && SIMPLE_OK_KINDS.has(kind)) return null;
  return "compressed reply kind invalid";
}

/** Best-effort error reply for a message the worker could not read as a request. */
export function imageUnreadableReply(data: unknown): ImageWorkerReply {
  const jobId = isRecord(data) && typeof data.jobId === "string" ? data.jobId : "";
  return {
    jobId,
    ok: false,
    error: { name: "Error", message: "malformed image request" },
  };
}

export function imageErrorReply(request: Pick<ImageWorkerRequest, "jobId">, error: unknown): ImageWorkerReply {
  return {
    jobId: request.jobId,
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : "image worker failed",
    },
  };
}