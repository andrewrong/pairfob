import { describe, expect, test } from "bun:test";
import {
  ImageEditError,
  canvasToBlob,
  editedFileName,
  loadEditableImage,
  paintPreview,
  previewGeometry,
  renderExport,
  screenToImage,
} from "./image-render";
import { createDoc, placeEllipse, placeMarker, setCrop } from "./image-model";

type Call = { name: string; args: unknown[] };

function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(target, prop) {
      if (prop === "__calls") return calls;
      return (...args: unknown[]) => { calls.push({ name: String(prop), args }); void target; };
    },
    set() {
      return true;
    },
  });
  return { ctx, calls };
}

function fakeBitmap(width = 100, height = 80): ImageBitmap {
  return { width, height, close() {}, } as unknown as ImageBitmap;
}

describe("loadEditableImage", () => {
  test("prefers createImageBitmap with EXIF orientation from-image", async () => {
    const optionsSeen: ImageBitmapOptions[] = [];
    const loaded = await loadEditableImage(new Blob(["x"], { type: "image/jpeg" }), {
      createBitmap: async (_blob, options) => {
        if (options) optionsSeen.push(options);
        return fakeBitmap();
      },
    });
    expect(optionsSeen).toEqual([{ imageOrientation: "from-image" }]);
    expect(loaded.width).toBe(100);
    loaded.release();
  });

  test("falls back to an img element decode when bitmap options are rejected", async () => {
    const bitmapCalls: string[] = [];
    const loaded = await loadEditableImage(new Blob(["x"], { type: "image/jpeg" }), {
      createBitmap: async () => {
        bitmapCalls.push("attempt");
        throw new TypeError("unsupported option");
      },
      imageElement: () => {
        const element = {
          decoding: "",
          src: "",
          naturalWidth: 12,
          naturalHeight: 24,
          onload: null as null | (() => void),
          onerror: null as null | (() => void),
        };
        queueMicrotask(() => {
          element.naturalWidth = 12;
          element.onload?.();
        });
        return element as unknown as HTMLImageElement;
      },
    });
    expect(bitmapCalls.length).toBe(2);
    expect(loaded.width).toBe(12);
    expect(loaded.height).toBe(24);
    loaded.release();
  });

  test("reports undecodable files explicitly so the original stays uploadable", async () => {
    await expect(loadEditableImage(new Blob(["x"], { type: "image/x-unknown" }), {
      createBitmap: async () => {
        throw new DOMException("bad", "InvalidStateError");
      },
      imageElement: () => {
        const element = {
          decoding: "",
          src: "",
          naturalWidth: 0,
          naturalHeight: 0,
          onload: null as null | (() => void),
          onerror: null as null | (() => void),
        };
        queueMicrotask(() => element.onerror?.());
        return element as unknown as HTMLImageElement;
      },
    })).rejects.toBeInstanceOf(ImageEditError);
  });
});

describe("preview geometry", () => {
  test("fits contain and maps screen points back to image space", () => {
    const doc = createDoc(200, 100);
    const geometry = previewGeometry(200, 200, doc);
    expect(geometry.scale).toBe(1);
    expect(geometry.offsetX).toBe(0);
    expect(geometry.offsetY).toBe(50);
    expect(screenToImage({ x: 10, y: 60 }, geometry)).toEqual({ x: 10, y: 10 });
  });

  test("painting never throws against a recording context", () => {
    const doc = placeMarker(createDoc(100, 100), { x: 50, y: 50 });
    const { ctx, calls } = recordingCtx();
    expect(() => paintPreview(ctx, {} as CanvasImageSource, doc, previewGeometry(100, 100, doc))).not.toThrow();
    expect(calls.some((call) => call.name === "drawImage")).toBe(true);
  });

  test("paints a live ellipse drag as an ellipse outline, never a crop scrim", () => {
    const doc = createDoc(100, 100);
    const { ctx, calls } = recordingCtx();
    paintPreview(
      ctx,
      {} as CanvasImageSource,
      doc,
      previewGeometry(100, 100, doc),
      { kind: "ellipse", from: { x: 10, y: 10 }, to: { x: 60, y: 40 } },
    );
    expect(calls.some((call) => call.name === "ellipse")).toBe(true);
    // No crop exists for an ellipse drag: no even-odd scrim fill.
    const fills = calls.filter((call) => call.name === "fill").map((call) => call.args[0]);
    expect(fills).not.toContain("evenodd");
  });
});

describe("flattened PNG export", () => {
  test("ellipse highlight is drawn but never clips: the full image is exported", () => {
    let doc = createDoc(100, 100);
    doc = placeEllipse(doc, { x: 10, y: 10 }, { x: 60, y: 60 });
    doc = placeMarker(doc, { x: 35, y: 35 });
    const { ctx, calls } = recordingCtx();
    const plan = renderExport(ctx, fakeBitmap(100, 100), doc);
    expect(plan).toMatchObject({ width: 100, height: 100 });
    const names = calls.map((call) => call.name);
    expect(names).not.toContain("clip");
    expect(names).toContain("ellipse");
    expect(names).toContain("drawImage");
    const translate = calls.find((call) => call.name === "translate");
    expect(translate?.args).toEqual([0, 0]);
  });

  test("rectangular crop bounds the export without clipping and draws annotations", () => {
    let doc = createDoc(200, 200);
    doc = setCrop(doc, { x: 50, y: 40 }, { x: 150, y: 140 });
    doc = placeEllipse(doc, { x: 60, y: 60 }, { x: 120, y: 120 });
    const { ctx, calls } = recordingCtx();
    const plan = renderExport(ctx, fakeBitmap(200, 200), doc);
    expect(plan).toMatchObject({ width: 100, height: 100 });
    const names = calls.map((call) => call.name);
    expect(names).not.toContain("clip");
    expect(names).toContain("ellipse");
    const translate = calls.find((call) => call.name === "translate");
    expect(translate?.args).toEqual([-50, -40]);
  });

  test("names the flattened output as PNG after the original base", () => {
    expect(editedFileName("photo.1.JPG")).toBe("photo.1.png");
    expect(editedFileName("archive")).toBe("archive.png");
  });

  test("canvasToBlob resolves a PNG blob and rejects missing output", async () => {
    const blob = new Blob(["x"]);
    await expect(canvasToBlob({ toBlob: (cb) => cb(blob) } as unknown as HTMLCanvasElement)).resolves.toBe(blob);
    await expect(canvasToBlob({ toBlob: (cb) => cb(null) } as unknown as HTMLCanvasElement)).rejects.toBeInstanceOf(ImageEditError);
  });
});
