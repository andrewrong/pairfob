import { describe, expect, test } from "bun:test";
import {
  HEADER_BYTES,
  JPEG_QUALITY,
  MAX_OUTPUT_DIMENSION,
  MAX_SOURCE_DIMENSION,
  MAX_SOURCE_PIXELS,
  MIN_IMAGE_BYTES,
  MIN_SAVING_RATIO,
  isScreenshotName,
  jpegDimensions,
  outputDimensions,
  pngDimensions,
  preserveReason,
  sniffFormat,
  sourceDimensionsSafe,
} from "./attachment-image-policy.ts";

// Correct SOF0 segment with 3 components (YCbCr). Payload after the length:
// precision(1) + height(2) + width(2) + components(1) + 3*3 component bytes
// = 15, so declared length = 17 (0x11).
function sofBytes(height: number, width: number, components = 3): number[] {
  const payload = [
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    components,
  ];
  for (let c = 0; c < components; c += 1) payload.push(0x01, 0x11, 0x00);
  return [0xff, 0xc0, 0x00, 0x11, ...payload];
}

// SOI + APP0 (zero payload, len 2) + correct SOF0 + trailing data byte.
function jpegWith(dims: { width: number; height: number } | null): Uint8Array {
  const height = dims ? dims.height : 0;
  const width = dims ? dims.width : 0;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x02,
    ...sofBytes(height, width),
    0x00, // trailing data byte
  ]);
}

function pngWith(width: number, height: number, opts: { length?: number; type?: string } = {}): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const chunkLength = opts.length ?? 13;
  out[8] = (chunkLength >>> 24) & 0xff; out[9] = (chunkLength >>> 16) & 0xff;
  out[10] = (chunkLength >>> 8) & 0xff; out[11] = chunkLength & 0xff;
  const type = (opts.type ?? "IHDR").split("").map((ch) => ch.charCodeAt(0));
  out.set(type, 12);
  out[16] = (width >>> 24) & 0xff; out[17] = (width >>> 16) & 0xff;
  out[18] = (width >>> 8) & 0xff; out[19] = width & 0xff;
  out[20] = (height >>> 24) & 0xff; out[21] = (height >>> 16) & 0xff;
  out[22] = (height >>> 8) & 0xff; out[23] = height & 0xff;
  // bit depth, colour type, compression, filter, interlace + CRC4 zeros
  return out;
}

const JPEG = { name: "photo.jpg", type: "image/jpeg", size: MIN_IMAGE_BYTES + 1 };
const PNG = { name: "photo.png", type: "image/png", size: MIN_IMAGE_BYTES + 1 };

describe("constants", () => {
  test("exposes the frozen thresholds", () => {
    expect(MIN_IMAGE_BYTES).toBe(262144);
    expect(MAX_SOURCE_PIXELS).toBe(24_000_000);
    expect(MAX_SOURCE_DIMENSION).toBe(32768);
    expect(MAX_OUTPUT_DIMENSION).toBe(2048);
    expect(JPEG_QUALITY).toBe(0.85);
    expect(MIN_SAVING_RATIO).toBe(0.1);
    expect(HEADER_BYTES).toBe(262144);
  });
});

describe("preserveReason", () => {
  test("small files bypass regardless of format", () => {
    expect(preserveReason({ name: "a.jpg", type: "image/jpeg", size: 0 })).toBe("small");
    expect(preserveReason({ ...JPEG, size: MIN_IMAGE_BYTES })).toBe("small");
    expect(preserveReason({ ...PNG, size: 100 })).toBe("small");
  });

  test("invalid size is treated as small (fail closed)", () => {
    expect(preserveReason({ name: "a.jpg", type: "image/jpeg", size: -1 })).toBe("small");
  });

  test("normal JPEG is eligible", () => {
    expect(preserveReason(JPEG)).toBeNull();
  });

  test("screenshot names preserve even JPEG", () => {
    const shots = ["screenshot.png", "my screen shot.png", "screen_shot.jpg", "截图.png", "屏幕快照.jpg"];
    for (const name of shots) {
      expect(preserveReason({ name, type: "image/jpeg", size: JPEG.size }, false)).toBe("preserved");
    }
  });

  test("PNG without photo flag is preserved", () => {
    expect(preserveReason(PNG)).toBe("preserved");
  });

  test("trusted edited PNG with photo is eligible", () => {
    expect(preserveReason(PNG, true)).toBeNull();
  });

  test("unknown MIME proceeds to worker for byte sniff (may be a real JPEG)", () => {
    expect(preserveReason({ name: "x.bin", type: "", size: JPEG.size })).toBeNull();
  });

  test("confident non-eligible MIME is preserved without a worker", () => {
    expect(preserveReason({ name: "photo.webp", type: "image/webp", size: JPEG.size })).toBe("preserved");
    expect(preserveReason({ name: "anim.gif", type: "image/gif", size: JPEG.size })).toBe("preserved");
    expect(preserveReason({ name: "vec.svg", type: "image/svg+xml", size: JPEG.size })).toBe("preserved");
    expect(preserveReason({ name: "img.heic", type: "image/heic", size: JPEG.size })).toBe("preserved");
    expect(preserveReason({ name: "img.avif", type: "image/avif", size: JPEG.size })).toBe("preserved");
  });
});

describe("sniffFormat", () => {
  test("recognises jpeg by bytes", () => {
    expect(sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  });
  test("recognises png by signature", () => {
    expect(sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]))).toBe("png");
  });
  test("recognises webp", () => {
    const b = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    expect(sniffFormat(b)).toBe("webp");
  });
  test("recognises avif brand", () => {
    const b = new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
    expect(sniffFormat(b)).toBe("avif");
  });
  test("recognises heic brand", () => {
    const b = new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(sniffFormat(b)).toBe("heic");
  });
  test("recognises svg including UTF-8 BOM", () => {
    expect(sniffFormat(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBe("svg");
    expect(sniffFormat(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x73, 0x76]))).toBe("svg");
  });
  test("recognises gif", () => {
    expect(sniffFormat(new Uint8Array([71, 73, 70, 56, 57, 97]))).toBe("gif");
  });
  test("returns unknown for empty/short/garbage", () => {
    expect(sniffFormat(new Uint8Array([]))).toBe("unknown");
    expect(sniffFormat(new Uint8Array([0, 1, 2]))).toBe("unknown");
  });
});

describe("jpegDimensions", () => {
  test("extracts dimensions across an unknown marker", () => {
    const h = jpegWith({ width: 640, height: 480 });
    expect(jpegDimensions(h)).toEqual({ width: 640, height: 480 });
  });

  test("returns null when header is not an SOI", () => {
    expect(jpegDimensions(new Uint8Array([0x00, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(jpegDimensions(new Uint8Array([0xff, 0x00]))).toBeNull();
  });

  test("returns null when SOS appears before SOF", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08]);
    expect(jpegDimensions(b)).toBeNull();
  });

  test("returns null for EOI before SOF", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(jpegDimensions(b)).toBeNull();
  });

  test("returns null on marker overrun (truncated)", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 0x01]);
    expect(jpegDimensions(b)).toBeNull();
  });

  test("returns null for zero dimensions", () => {
    const h = jpegWith({ width: 0, height: 0 });
    expect(jpegDimensions(h)).toBeNull();
  });

  test("rejects a segment whose declared length is bigger than available bytes", () => {
    // SOF declares 0x0008 but only 2 payload bytes are present in the buffer.
    const h = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x01,
    ]);
    expect(jpegDimensions(h)).toBeNull();
  });

  test("rejects a declared length that does not match component count", () => {
    // Declares length 17 but a component count of 2 (would need 14 payload bytes).
    const h = jpegWith({ width: 100, height: 100 });
    h[9] = 0x11;
    h[15] = 0x02; // components = 2 -> length must be 8 + 6 = 14 (0x0e), not 17
    expect(jpegDimensions(h)).toBeNull();
  });

  test("rejects a zero component count", () => {
    const h = jpegWith({ width: 100, height: 100 });
    h[15] = 0x00;
    expect(jpegDimensions(h)).toBeNull();
  });

  test("rejects a segment with length < 8", () => {
    // SOF declares length 0x0003 (too short for precision/height/width/comp).
    const h = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x03, 0x08, 0x00, 0x64,
    ]);
    expect(jpegDimensions(h)).toBeNull();
  });
});

describe("pngDimensions", () => {
  test("extracts dimensions from a valid IHDR", () => {
    expect(pngDimensions(pngWith(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });
  test("returns null for short headers", () => {
    expect(pngDimensions(new Uint8Array(16))).toBeNull();
  });
  test("returns null when signature is wrong", () => {
    const b = pngWith(10, 10);
    b[3] = 0x00;
    expect(pngDimensions(b)).toBeNull();
  });
  test("returns null when IHDR type is missing", () => {
    const b = pngWith(10, 10);
    b[12] = 0x58; // 'X' instead of 'I'
    expect(pngDimensions(b)).toBeNull();
  });

  test("rejects a truncated 24-byte header even with magic + IHDR type", () => {
    const b = pngWith(10, 10).slice(0, 24);
    expect(b.length).toBe(24);
    expect(pngDimensions(b)).toBeNull();
  });

  test("rejects a chunk whose declared length is not 13", () => {
    const b = pngWith(10, 10, { length: 12 });
    expect(pngDimensions(b)).toBeNull();
  });
});

describe("sourceDimensionsSafe", () => {
  test("accepts a valid large image under the pixel cap", () => {
    // 6000 x 4000 = 24,000,000 exactly <= cap
    expect(sourceDimensionsSafe(6000, 4000)).toBe(true);
  });
  test("rejects over the total pixel cap", () => {
    expect(sourceDimensionsSafe(6001, 4000)).toBe(false);
  });
  test("rejects a per-dimension over 32768 even under pixel cap", () => {
    expect(sourceDimensionsSafe(40000, 100)).toBe(false);
  });
  test("rejects zero/negative/non-integer", () => {
    expect(sourceDimensionsSafe(0, 10)).toBe(false);
    expect(sourceDimensionsSafe(10, -1)).toBe(false);
    expect(sourceDimensionsSafe(10.5, 10)).toBe(false);
    expect(sourceDimensionsSafe(Number.NaN, 10)).toBe(false);
  });
});

describe("outputDimensions", () => {
  test("scales the long edge to MAX_OUTPUT_DIMENSION", () => {
    expect(outputDimensions(4000, 2000)).toEqual({ width: 2048, height: 1024 });
  });
  test("never upscales small images", () => {
    expect(outputDimensions(100, 50)).toEqual({ width: 100, height: 50 });
  });
  test("handles portrait orientation", () => {
    expect(outputDimensions(1000, 4000)).toEqual({ width: 512, height: 2048 });
  });
  test("never emits zero", () => {
    expect(outputDimensions(1, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe("isScreenshotName", () => {
  test("matches the frozen screenshot regex", () => {
    expect(isScreenshotName("screenshot-001.png")).toBe(true);
    expect(isScreenshotName("my screen shot.png")).toBe(true);
    expect(isScreenshotName("屏幕快照.png")).toBe(true);
    expect(isScreenshotName("photo.jpg")).toBe(false);
  });
});