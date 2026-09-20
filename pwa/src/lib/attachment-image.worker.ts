/**
 * Attachment image worker: all header inspection, decode, draw and encode
 * happens here, never on the main thread. Receives a structured-clone `File`
 * plus the explicit `photo` trust flag, and replies with a bounded result or
 * error. The main thread terminates this worker after every settle.
 *
 * Classification follows the frozen policy:
 * - JPEG (not a screenshot name) -> attempt JPEG compression;
 * - trusted edited PNG (photo:true and not a screenshot name) -> attempt;
 * - every other format and screenshots -> preserved;
 * - unrecognised bytes -> unsupported;
 * - missing decoding APIs (createImageBitmap/OffscreenCanvas/convertToBlob)
 *   -> unsupported rather than crashing.
 *
 * The source is guarded by header dimensions AND again by the actual decoded
 * bitmap dimensions (which reflect EXIF orientation) using sourceDimensionsSafe
 * BEFORE draw, so a massive image is never fully rasterised at output size.
 * Output is long-edge <= MAX_OUTPUT_DIMENSION, JPEG quality .85, and accepted
 * only when it is genuinely JPEG bytes/type and saves >= 10%. The bitmap is
 * closed and the canvas released after every settle.
 *
 * Type note: the project compiles with the DOM lib only (no global WebWorker
 * lib). The worker global is declared locally as the small surface this entry
 * touches.
 */
import {
  imageErrorReply,
  imageUnreadableReply,
  isImageRequest,
  type ImageWorkerReply,
  type ImageWorkerRequest,
} from "./attachment-image-protocol.ts";
import {
  HEADER_BYTES,
  JPEG_QUALITY,
  MIN_SAVING_RATIO,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_OUTPUT_BYTES,
  isScreenshotName,
  jpegDimensions,
  jpegExportName,
  outputDimensions,
  pngDimensions,
  pngIsStatic,
  sniffFormat,
  sourceDimensionsSafe,
  thumbnailDimensions,
  type ImageFormat,
} from "./attachment-image-policy.ts";

type ImageWorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: ImageWorkerReply): void;
};

const workerScope = globalThis as unknown as ImageWorkerScope;

function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Feature-detect the drawing APIs; absence means unsupported, not a crash. */
function drawingSupported(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;
  const OffscreenCanvasImpl = g.OffscreenCanvas as
    | { prototype?: { convertToBlob?: unknown } }
    | undefined;
  // convertToBlob must exist on the prototype, not just the constructor.
  return typeof g.createImageBitmap === "function"
    && typeof g.OffscreenCanvas === "function"
    && typeof OffscreenCanvasImpl?.prototype?.convertToBlob === "function";
}

/**
 * Attempt JPEG compression. `jobId` is threaded through so every reply is
 * bound to the originating request; a decode/encode failure maps to a
 * worker-side failure (host falls back to the original).
 */
async function compressToJpeg(file: File, jobId: string): Promise<ImageWorkerReply> {
  if (!drawingSupported()) return { jobId, ok: true, kind: "unsupported" };
  let bitmap: ImageBitmap | null = null;
  let canvas: OffscreenCanvas | null = null;
  try {
    // createImageBitmap honours EXIF orientation by default ('from-image');
    // the decoded dims are authoritative for geometry.
    bitmap = await createImageBitmap(file);
    if (!sourceDimensionsSafe(bitmap.width, bitmap.height)) {
      // Re-check the ACTUAL decode (orientation/rounding can differ from header).
      return { jobId, ok: true, kind: "failed" };
    }
    const target = outputDimensions(bitmap.width, bitmap.height);
    canvas = new OffscreenCanvas(target.width, target.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { jobId, ok: true, kind: "unsupported" };
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    // Never silently accept a PNG fallback re-encoded by the browser.
    if (blob.type !== "image/jpeg" || !isJpegBytes(head) || blob.size === 0) {
      return { jobId, ok: true, kind: "not-smaller" };
    }
    if (blob.size <= file.size * (1 - MIN_SAVING_RATIO)) {
      return {
        jobId,
        ok: true,
        kind: "compressed",
        blob,
        mime: "image/jpeg",
        name: jpegExportName(file.name),
        width: target.width,
        height: target.height,
      };
    }
    return { jobId, ok: true, kind: "not-smaller" };
  } catch {
    return { jobId, ok: true, kind: "failed" };
  } finally {
    bitmap?.close();
    (canvas as unknown as { close?: () => void } | null)?.close?.();
  }
}

/**
 * Build a bounded thumbnail (long edge <= 128). Only static JPEG/PNG bytes
 * are accepted; APNG (`acTL` before `IDAT`) and a scan that ends before the
 * first IDAT are refused rather than guessed static. Header dimensions and
 * the actual decoded bitmap are both bounds-checked before drawing; PNG
 * input encodes PNG (alpha preserved), JPEG input encodes JPEG q.75, and the
 * encoded blob is accepted only with matching real bytes within 128 KiB.
 * Every failure settles to a simple reply — the host maps those to null.
 */
async function makeThumbnail(
  file: File,
  jobId: string,
  scan: Uint8Array,
  format: ImageFormat,
): Promise<ImageWorkerReply> {
  if (format !== "jpeg" && format !== "png") {
    return { jobId, ok: true, kind: "unsupported" };
  }
  if (!drawingSupported()) return { jobId, ok: true, kind: "unsupported" };
  const headerDims = format === "jpeg" ? jpegDimensions(scan) : pngDimensions(scan);
  if (!headerDims || !sourceDimensionsSafe(headerDims.width, headerDims.height)) {
    return { jobId, ok: true, kind: "failed" };
  }
  if (format === "png" && pngIsStatic(scan) !== true) {
    // Animated PNG, or static-ness undetermined within the scan: refuse.
    return { jobId, ok: true, kind: "unsupported" };
  }
  let bitmap: ImageBitmap | null = null;
  let canvas: OffscreenCanvas | null = null;
  try {
    // createImageBitmap honours EXIF orientation by default ('from-image').
    bitmap = await createImageBitmap(file);
    if (!sourceDimensionsSafe(bitmap.width, bitmap.height)) {
      return { jobId, ok: true, kind: "failed" };
    }
    const target = thumbnailDimensions(bitmap.width, bitmap.height);
    canvas = new OffscreenCanvas(target.width, target.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { jobId, ok: true, kind: "unsupported" };
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const blob = format === "png"
      ? await canvas.convertToBlob({ type: "image/png" })
      : await canvas.convertToBlob({ type: "image/jpeg", quality: THUMBNAIL_JPEG_QUALITY });
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    // Real bytes/type must agree with the source format; no silent fallback.
    if (blob.type !== mime || sniffFormat(head) !== format || blob.size === 0) {
      return { jobId, ok: true, kind: "failed" };
    }
    if (blob.size > THUMBNAIL_MAX_OUTPUT_BYTES) {
      return { jobId, ok: true, kind: "failed" };
    }
    return {
      jobId,
      ok: true,
      kind: "thumbnail",
      blob,
      mime,
      width: target.width,
      height: target.height,
    };
  } catch {
    return { jobId, ok: true, kind: "failed" };
  } finally {
    bitmap?.close();
    (canvas as unknown as { close?: () => void } | null)?.close?.();
  }
}

async function handle(request: ImageWorkerRequest): Promise<ImageWorkerReply> {
  const { file, photo, jobId } = request;
  const scan = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const format = sniffFormat(scan);
  // Thumbnail task: its own static-JPEG/PNG bounded path.
  if ((request.task ?? "image") === "thumbnail") {
    return makeThumbnail(file, jobId, scan, format);
  }
  // Screenshot names are preserved regardless of the underlying format
  // (applies to trusted edited PNG as well as JPEG).
  if (isScreenshotName(file.name)) return { jobId, ok: true, kind: "preserved" };

  if (format === "jpeg") {
    const dims = jpegDimensions(scan);
    if (dims && sourceDimensionsSafe(dims.width, dims.height)) {
      return compressToJpeg(file, jobId);
    }
    return { jobId, ok: true, kind: "failed" };
  }

  if (format === "png") {
    if (photo) {
      const dims = pngDimensions(scan);
      if (dims && sourceDimensionsSafe(dims.width, dims.height)) {
        return compressToJpeg(file, jobId);
      }
      return { jobId, ok: true, kind: "failed" };
    }
    return { jobId, ok: true, kind: "preserved" };
  }

  if (format === "gif" || format === "webp" || format === "avif" || format === "heic" || format === "svg") {
    return { jobId, ok: true, kind: "preserved" };
  }
  return { jobId, ok: true, kind: "unsupported" };
}

workerScope.addEventListener("message", (event: MessageEvent) => {
  const data: unknown = event.data;
  if (!isImageRequest(data)) {
    workerScope.postMessage(imageUnreadableReply(data));
    return;
  }
  void handle(data)
    .then((reply) => workerScope.postMessage(reply))
    .catch((error: unknown) => workerScope.postMessage(imageErrorReply(data, error)));
});