/**
 * Canvas side of the image editor: browser decode (EXIF orientation honored by
 * the browser), preview painting, and flattened PNG export under pixel caps.
 *
 * All drawing takes its context as a parameter and never touches
 * `document`/`window` directly except through the injectable canvas factory, so
 * the flatten math stays testable under a recording 2D context.
 */
import {
  annotationUnit,
  sourceRect,
  type DraftGesture,
  type EditorDoc,
  type ExportPlan,
  type Point,
  type Rect,
  type Shape,
  exportPlan,
} from "./image-model";

export class ImageEditError extends Error {}

export type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
};

type BitmapCtor = (blob: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;

function bitmapCtor(): BitmapCtor | null {
  return typeof globalThis.createImageBitmap === "function"
    ? (globalThis.createImageBitmap as BitmapCtor).bind(globalThis)
    : null;
}

/**
 * Decode with the browser's own EXIF-orientation handling. `createImageBitmap`
 * is preferred; an `<img>` decode is the fallback. A file the browser cannot
 * decode is an explicit ImageEditError — the original file stays uploadable.
 */
export async function loadEditableImage(
  file: Blob,
  env: { createBitmap?: BitmapCtor; imageElement?: () => HTMLImageElement } = {},
): Promise<LoadedImage> {
  const create = env.createBitmap ?? bitmapCtor();
  if (create) {
    try {
      const bitmap = await create(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch (error) {
      if (error instanceof ImageEditError) throw error;
      // Some engines reject the options bag; retry without it before falling back.
      try {
        const bitmap = await create(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      } catch (secondError) {
        if (secondError instanceof ImageEditError) throw secondError;
      }
    }
  }
  const makeImage = env.imageElement
    ?? (() => {
      const element = new Image();
      element.decoding = "async";
      return element;
    });
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = makeImage();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new ImageEditError("image-undecodable"));
      element.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new ImageEditError("image-undecodable");
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => { URL.revokeObjectURL(url); },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    if (error instanceof ImageEditError) throw error;
    throw new ImageEditError("image-undecodable");
  }
}

export type PreviewGeometry = {
  scale: number;
  offsetX: number;
  offsetY: number;
  canvasWidth: number;
  canvasHeight: number;
};

/** Fit the image (contain) into the editor canvas backing store. */
export function previewGeometry(canvasWidth: number, canvasHeight: number, doc: EditorDoc): PreviewGeometry {
  const scale = Math.min(canvasWidth / doc.width, canvasHeight / doc.height);
  const renderedW = doc.width * scale;
  const renderedH = doc.height * scale;
  return {
    scale,
    offsetX: (canvasWidth - renderedW) / 2,
    offsetY: (canvasHeight - renderedH) / 2,
    canvasWidth,
    canvasHeight,
  };
}

export function screenToImage(point: Point, geometry: PreviewGeometry): Point {
  return {
    x: (point.x - geometry.offsetX) / geometry.scale,
    y: (point.y - geometry.offsetY) / geometry.scale,
  };
}

const INK = "#f5f7fa";
const ACCENT = "#6ea8fe";
const ACCENT_DEEP = "#0a0d12";

function drawArrowHead(ctx: CanvasRenderingContext2D, from: Point, to: Point, size: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = ACCENT;
  ctx.fill();
}

function drawEllipse(ctx: CanvasRenderingContext2D, rect: Rect, unit: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = Math.max(3, unit * 0.42);
  ctx.beginPath();
  ctx.ellipse(
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    Math.max(1, rect.w / 2),
    Math.max(1, rect.h / 2),
    0, 0, Math.PI * 2,
  );
  ctx.stroke();
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, unit: number): void {
  if (shape.kind === "ellipse") {
    drawEllipse(ctx, shape.rect, unit);
    return;
  }
  if (shape.kind === "arrow") {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(2, unit * 0.3);
    ctx.beginPath();
    ctx.moveTo(shape.from.x, shape.from.y);
    ctx.lineTo(shape.to.x, shape.to.y);
    ctx.stroke();
    drawArrowHead(ctx, shape.from, shape.to, unit * 1.1);
    return;
  }
  if (shape.kind === "text") {
    const size = unit * 1.4;
    ctx.font = `600 ${size}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.strokeStyle = ACCENT_DEEP;
    ctx.strokeText(shape.text, shape.at.x, shape.at.y + size * 0.35);
    ctx.fillStyle = INK;
    ctx.fillText(shape.text, shape.at.x, shape.at.y + size * 0.35);
    return;
  }
  const radius = unit * 1.15;
  ctx.beginPath();
  ctx.arc(shape.at.x, shape.at.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, unit * 0.12);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = ACCENT_DEEP;
  ctx.font = `700 ${unit * 1.25}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(shape.number), shape.at.x, shape.at.y + radius * 0.05);
}

function drawShapes(ctx: CanvasRenderingContext2D, doc: EditorDoc, unit: number): void {
  for (const shape of doc.shapes) drawShape(ctx, shape, unit);
}

function cropOverlayPath(ctx: CanvasRenderingContext2D, doc: EditorDoc, geometry: PreviewGeometry): void {
  const rect = sourceRect(doc);
  const left = geometry.offsetX + rect.x * geometry.scale;
  const top = geometry.offsetY + rect.y * geometry.scale;
  const width = rect.w * geometry.scale;
  const height = rect.h * geometry.scale;
  const { canvasWidth, canvasHeight } = geometry;
  ctx.beginPath();
  ctx.rect(0, 0, canvasWidth, canvasHeight);
  ctx.rect(left, top, width, height);
  ctx.fillStyle = "rgba(6, 9, 14, 0.55)";
  ctx.fill("evenodd");
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.strokeRect(left, top, width, height);
  ctx.setLineDash([]);
}

/** Paint the editor canvas: image, annotations, live drag, crop scrim. */
export function paintPreview(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  doc: EditorDoc,
  geometry: PreviewGeometry,
  draft?: { from: Point; to: Point; kind: DraftGesture["tool"] } | null,
): void {
  const { canvasWidth, canvasHeight } = geometry;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.save();
  ctx.translate(geometry.offsetX, geometry.offsetY);
  ctx.scale(geometry.scale, geometry.scale);
  ctx.drawImage(image, 0, 0, doc.width, doc.height);
  drawShapes(ctx, doc, annotationUnit({ x: 0, y: 0, w: doc.width, h: doc.height }));
  if (draft?.kind === "arrow") {
    drawShape(ctx, { kind: "arrow", from: draft.from, to: draft.to }, annotationUnit({ x: 0, y: 0, w: doc.width, h: doc.height }));
  }
  ctx.restore();
  if (doc.crop) cropOverlayPath(ctx, doc, geometry);
  if (draft && (draft.kind === "cropRect" || draft.kind === "ellipse")) {
    const left = geometry.offsetX + Math.min(draft.from.x, draft.to.x) * geometry.scale;
    const top = geometry.offsetY + Math.min(draft.from.y, draft.to.y) * geometry.scale;
    const w = Math.abs(draft.from.x - draft.to.x) * geometry.scale;
    const h = Math.abs(draft.from.y - draft.to.y) * geometry.scale;
    if (draft.kind === "ellipse") {
      const unit = annotationUnit({ x: 0, y: 0, w: doc.width, h: doc.height }) * geometry.scale;
      drawEllipse(ctx, { x: left, y: top, w, h }, unit);
    } else {
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.strokeRect(left, top, w, h);
      ctx.setLineDash([]);
    }
  }
}

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

export function defaultCanvasFactory(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Flatten the edit to a capped PNG. The rectangular crop becomes the output
 * bounds; highlight ellipses and the other annotations are drawn on top and
 * never remove image content.
 */
export function renderExport(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  doc: EditorDoc,
  plan?: ExportPlan,
): ExportPlan {
  const resolved = plan ?? exportPlan(doc);
  ctx.clearRect(0, 0, resolved.width, resolved.height);
  ctx.save();
  ctx.scale(resolved.scale, resolved.scale);
  ctx.translate(resolved.source.x ? -resolved.source.x : 0, resolved.source.y ? -resolved.source.y : 0);
  ctx.drawImage(image, 0, 0, doc.width, doc.height);
  drawShapes(ctx, doc, annotationUnit(resolved.source));
  ctx.restore();
  return resolved;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new ImageEditError("png-export-failed"));
    }, "image/png");
  });
}

/** Edited images are always flattened PNGs, named after the original base. */
export function editedFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base || "attachment"}.png`;
}
