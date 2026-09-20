/**
 * Pure policy + header-scanning helpers for attachment image compression.
 *
 * This module has no DOM/Worker/device-drawing dependency so the behaviour can
 * be unit-tested directly and shared with the worker entry. It decides ONLY
 * which files are eligible to attempt compression and what geometry to use;
 * actual decode/draw/encode happen elsewhere.
 *
 * Policy (frozen image-core contract):
 * - files <= MIN_IMAGE_BYTES are bypassed (reason 'small');
 * - otherwise only a) normal JPEG, and b) a trusted edited PNG explicitly
 *   marked photo:true, are eligible; named screenshots are preserved even for
 *   JPEG; every other format (PNG without photo, WebP/AVIF/HEIC/GIF/SVG, and
 *   anything we cannot recognise) stays original ('preserved' / 'unsupported');
 * - dimensions are validated with safe-integer caps before any decode:
 *   > MAX_SOURCE_PIXELS or per-dimension > MAX_SOURCE_DIMENSION is rejected;
 * - output is scaled so the long edge <= MAX_OUTPUT_DIMENSION with no upscale.
 */
export const MIN_IMAGE_BYTES = 262144;
export const MAX_SOURCE_PIXELS = 24_000_000;
export const MAX_SOURCE_DIMENSION = 32768;
export const MAX_OUTPUT_DIMENSION = 2048;
export const JPEG_QUALITY = 0.85;
/** Compression must save at least this fraction of the input to be used. */
export const MIN_SAVING_RATIO = 0.1;
/** Maximum header region scanned for format/dimension sniffing. */
export const HEADER_BYTES = 262144;

// --- Thumbnail task bounds (shared queue, distinct outcome) ---
/** Inputs larger than 40 MiB are fast-rejected on the host before enqueue. */
export const THUMBNAIL_MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** Thumbnail long edge is at most 128 CSS pixels. */
export const THUMBNAIL_MAX_OUTPUT_DIMENSION = 128;
/** A thumbnail blob is accepted only up to 128 KiB. */
export const THUMBNAIL_MAX_OUTPUT_BYTES = 128 * 1024;
/** JPEG thumbnails encode at a lighter quality than the 0.85 main image. */
export const THUMBNAIL_JPEG_QUALITY = 0.75;

const SCREENSHOT_RE = /screenshot|screen[ _-]?shot|截[图屏]|屏幕快照/i;

/**
 * Names that preserve the original even when the bytes look like a JPEG.
 * Screenshots and clipped window captures are intentionally kept lossless.
 */
export function isScreenshotName(name: string): boolean {
  return SCREENSHOT_RE.test(name);
}

/** Byte signatures used to sniff the real payload format, independent of MIME. */
export type ImageFormat =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "avif"
  | "heic"
  | "svg"
  | "unknown";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (b: number): string => String.fromCharCode(b);

function isFtypHeader(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    ascii(bytes[4]) === "f" &&
    ascii(bytes[5]) === "t" &&
    ascii(bytes[6]) === "y" &&
    ascii(bytes[7]) === "p"
  );
}

function brandAt(bytes: Uint8Array, index: number): string {
  return ascii(bytes[index]) + ascii(bytes[index + 1]) +
    ascii(bytes[index + 2]) + ascii(bytes[index + 3]);
}

const HEIC_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
  "mif1", "msf1", "msf2",
]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/**
 * Sniff the payload format from the leading header bytes. A short header
 * (fewer bytes than the longest signature) returns 'unknown' rather than
 * guessing; the caller treats that as not-eligible.
 */
export function sniffFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) {
    return "png";
  }
  if (bytes.length >= 4 && ascii(bytes[0]) === "G" && ascii(bytes[1]) === "I" &&
    ascii(bytes[2]) === "F" && ascii(bytes[3]) === "8") {
    return "gif";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes[0]) === "R" && ascii(bytes[1]) === "I" &&
    ascii(bytes[2]) === "F" && ascii(bytes[3]) === "F" &&
    ascii(bytes[8]) === "W" && ascii(bytes[9]) === "E" &&
    ascii(bytes[10]) === "B" && ascii(bytes[11]) === "P"
  ) {
    return "webp";
  }
  if (isFtypHeader(bytes)) {
    const major = brandAt(bytes, 8);
    if (AVIF_BRANDS.has(major)) return "avif";
    if (HEIC_BRANDS.has(major)) return "heic";
    // Some AVIF/HEIC files lead with a compatible-brand secondary box; sniff
    // a handful of following boxes for the brand when the major brand is "isom".
    if (major === "isom") {
      for (let i = 16; i + 8 <= bytes.length; i += 4) {
        const brand = brandAt(bytes, i);
        if (AVIF_BRANDS.has(brand)) return "avif";
        if (HEIC_BRANDS.has(brand)) return "heic";
      }
    }
    return "unknown";
  }
  // SVG is text: allow a UTF-8 BOM before the '<'.
  if (
    (bytes.length >= 1 && bytes[0] === 0x3c) ||
    (bytes.length >= 4 && bytes[0] === 0xef && bytes[1] === 0xbb &&
      bytes[2] === 0xbf && bytes[3] === 0x3c)
  ) {
    return "svg";
  }
  return "unknown";
}

const SOF_MARKERS: ReadonlySet<number> = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Scan a JPEG header for the first Start-Of-Frame marker to extract the coded
 * (pre-EXIF-orientation) width/height. Unknown markers are skipped by their
 * declared length; the scan is bounded by the header length and fails closed
 * (returns null) on a malformed marker, an early SOS/EOI, or when no SOF is
 * found within the scanned region — the caller then keeps the original.
 */
export function jpegDimensions(header: Uint8Array): { width: number; height: number } | null {
  if (header.length < 8 || header[0] !== 0xff || header[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < header.length) {
    if (header[i] !== 0xff) return null; // lost marker sync
    while (i < header.length && header[i] === 0xff) i += 1; // marker padding
    if (i >= header.length) return null;
    const marker = header[i];
    i += 1;
    if (marker === 0x00) return null; // stuffed byte where a marker belongs
    if (marker === 0xd9 || marker === 0x01) return null; // EOI/TEM before any SOF
    if (marker === 0xda) return null; // SOS reached without seeing a SOF
    if (marker >= 0xd0 && marker <= 0xd7) continue; // RSTn: no payload
    if (i + 1 >= header.length) return null;
    const length = (header[i] << 8) | header[i + 1];
    if (length < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      // SOF payload after the 2-byte length: precision(1) + height(2) +
      // width(2) + component count(1). Require a complete, in-scan segment
      // with a nonzero component count and a length compatible with the
      // components (8 + 3 * components).
      if (i + length > header.length) return null; // segment overruns the scan
      if (length < 8) return null;
      if (i + 7 >= header.length) return null;
      const height = (header[i + 3] << 8) | header[i + 4];
      const width = (header[i + 5] << 8) | header[i + 6];
      const components = header[i + 7];
      if (components === 0) return null; // no image components
      if (length !== 8 + components * 3) return null; // declared length mismatch
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    if (i + length > header.length) return null; // marker overruns the scan
    i += length;
  }
  return null;
}

/**
 * Parse PNG width/height from a complete IHDR chunk. A valid IHDR requires
 * the 8-byte signature, a 4-byte length == 13, the 4-byte "IHDR" type, 13
 * data bytes (width, height, bit depth, colour type, compression, filter,
 * interlace), and a 4-byte CRC — 33 bytes in total. Only called for an
 * explicitly trusted edited PNG; null means "cannot trust" (keep original).
 */
export function pngDimensions(header: Uint8Array): { width: number; height: number } | null {
  if (header.length < 33) return null;
  for (let i = 0; i < 8; i += 1) {
    if (header[i] !== PNG_SIGNATURE[i]) return null;
  }
  // chunk length must be exactly 13
  const chunkLength = (header[8] << 24) | (header[9] << 16) | (header[10] << 8) | header[11];
  if (chunkLength !== 13) return null;
  if (
    ascii(header[12]) !== "I" || ascii(header[13]) !== "H" ||
    ascii(header[14]) !== "D" || ascii(header[15]) !== "R"
  ) {
    return null;
  }
  const width = (header[16] << 24) | (header[17] << 16) | (header[18] << 8) | header[19];
  const height = (header[20] << 24) | (header[21] << 16) | (header[22] << 8) | header[23];
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Reject geometry that would force a massive or malformed decode: dimensions
 * must be positive safe integers within MAX_SOURCE_DIMENSION and the pixel
 * count within MAX_SOURCE_PIXELS.
 */
export function sourceDimensionsSafe(width: number, height: number): boolean {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) return false;
  if (width * height > MAX_SOURCE_PIXELS) return false;
  return true;
}

/**
 * Scaling goal: the long edge becomes `maxLongEdge` with no upscale,
 * preserving aspect ratio, and never emits a zero dimension.
 */
export function fitDimensions(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  const scale = Math.min(1, maxLongEdge / longEdge);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Main-image output geometry: long edge <= MAX_OUTPUT_DIMENSION, no upscale. */
export function outputDimensions(width: number, height: number): { width: number; height: number } {
  return fitDimensions(width, height, MAX_OUTPUT_DIMENSION);
}

/** Thumbnail output geometry: long edge <= 128, no upscale. */
export function thumbnailDimensions(width: number, height: number): { width: number; height: number } {
  return fitDimensions(width, height, THUMBNAIL_MAX_OUTPUT_DIMENSION);
}

/**
 * Determine whether a PNG is static by walking chunks in the scanned header.
 * An `acTL` chunk before the first `IDAT` marks an animated PNG (APNG); an
 * `IDAT` seen first confirms a static PNG. Returns null when the scanned
 * region ends before the first IDAT — callers must NOT guess static then.
 *
 * Assumes the caller already verified the 8-byte PNG signature.
 */
export function pngIsStatic(header: Uint8Array): boolean | null {
  let i = PNG_SIGNATURE.length; // 8
  while (i + 8 <= header.length) {
    // Chunk header: 4-byte big-endian length then a 4-byte ASCII type.
    const length = (header[i] << 24) | (header[i + 1] << 16) |
      (header[i + 2] << 8) | header[i + 3];
    const type = ascii(header[i + 4]) + ascii(header[i + 5]) +
      ascii(header[i + 6]) + ascii(header[i + 7]);
    if (type === "acTL") return false; // animation control chunk precedes IDAT
    if (type === "IDAT") return true; // first IDAT without acTL -> static
    if (!Number.isSafeInteger(length) || length < 0) return null;
    // Skip length(4) + type(4) + data(length) + CRC(4). The chunk data must
    // lie fully inside the scan; if not, the first IDAT was never reached.
    const next = i + 12 + length;
    if (!Number.isSafeInteger(next) || next > header.length) return null;
    i = next;
  }
  return null; // scan ended before any IDAT
}

/**
 * Decide the non-compression outcome for a file before any worker work, or
 * null when the file could still be a compressible JPEG (byte inspection must
 * then run inside the worker). This is a metadata fast-path only — it never
 * blocks a real JPEG that merely carries an unknown/empty MIME type.
 *
 * @param file minimal {name,type,size} view of the file.
 * @param photo true only for a trusted edited PNG originally sourced from a
 *   JPEG (never inferred from bytes here — callers supply the explicit flag).
 * @returns 'small' (size threshold bypass), 'preserved' (format/name kept as
 *   original, no worker needed), or null when we should attempt compression.
 */
export function preserveReason(
  file: { name: string; type: string; size: number },
  photo = false,
): "small" | "preserved" | null {
  if (!Number.isSafeInteger(file.size) || file.size < 0) return "small";
  if (file.size <= MIN_IMAGE_BYTES) return "small";
  if (isScreenshotName(file.name)) return "preserved";
  const format = typeFormatHint(file.type);
  if (format === "jpeg") return null;
  if (format === "png") return photo ? null : "preserved";
  // A confident non-eligible MIME is preserved without a worker; anything
  // unknown/empty proceeds so the worker can byte-sniff a real JPEG.
  if (format === "gif" || format === "webp" || format === "avif" ||
      format === "heic" || format === "svg") {
    return "preserved";
  }
  return null;
}

/**
 * Host-side thumbnail fast gate. Returns a rejection reason before any
 * worker is allocated: 'too-large' beyond 40 MiB, 'unsupported-mime' for a
 * confident non-JPEG/PNG MIME. Empty/unknown MIME passes so the worker can
 * byte-sniff (authoritative classification happens there).
 */
export function thumbnailRejectReason(
  file: { type: string; size: number },
): "too-large" | "unsupported-mime" | null {
  if (!Number.isSafeInteger(file.size) || file.size < 0) return "too-large";
  if (file.size > THUMBNAIL_MAX_INPUT_BYTES) return "too-large";
  const format = typeFormatHint(file.type);
  if (format === "jpeg" || format === "png" || format === "unknown") return null;
  return "unsupported-mime";
}

/** Best-effort MIME->format hint; the worker re-sniffs actual bytes. */
export function typeFormatHint(type: string): ImageFormat {
  const t = type.toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg" || t === "image/pjpeg") return "jpeg";
  if (t === "image/png") return "png";
  if (t === "image/gif") return "gif";
  if (t === "image/webp") return "webp";
  if (t === "image/avif") return "avif";
  if (t === "image/heic" || t === "image/heif" || t === "image/heif-sequence") return "heic";
  if (t === "image/svg+xml") return "svg";
  return "unknown";
}

/**
 * Derive the output filename from a trusted original name, forcing the JPEG
 * extension. Replaces the last extension (or appends .jpg when absent).
 */
export function jpegExportName(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${base}.jpg`;
}