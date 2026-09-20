/**
 * Pure image-edit document model.
 *
 * Coordinates are decoded image pixel space. A document holds an ordered stack
 * of annotations (arrows, text, numbered markers, highlight ellipses) and at
 * most one rectangular crop frame. The ellipse tool highlights content while
 * keeping the whole image; only the rectangle tool crops. Every mutation is a
 * pure reducer; the canvas renderer and pointer UI live elsewhere.
 */

export type Point = { x: number; y: number };

export type ArrowShape = { kind: "arrow"; from: Point; to: Point };
export type TextShape = { kind: "text"; at: Point; text: string };
export type MarkerShape = { kind: "marker"; at: Point; number: number };
/** Ellipse/circle highlight; inscribed in the dragged rectangle. */
export type EllipseShape = { kind: "ellipse"; rect: Rect };
export type Shape = ArrowShape | TextShape | MarkerShape | EllipseShape;

export type Rect = { x: number; y: number; w: number; h: number };

/** The only crop is rectangular. */
export type CropFrame = { rect: Rect };

export type EditorDoc = {
  width: number;
  height: number;
  shapes: readonly Shape[];
  crop: CropFrame | null;
};

export type EditorTool = "cropRect" | "ellipse" | "arrow" | "text" | "marker";

/** Exported PNG caps: long edge and total pixels, regardless of source size. */
export const IMAGE_EXPORT_MAX_DIMENSION = 4096;
export const IMAGE_EXPORT_MAX_PIXELS = 16_777_216;
/** Gestures smaller than this (image pixels) are taps, not arrows/frames. */
export const MIN_GESTURE_PIXELS = 6;

export function createDoc(width: number, height: number): EditorDoc {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new RangeError("image dimensions must be positive");
  }
  return { width: Math.round(width), height: Math.round(height), shapes: [], crop: null };
}

export function clampPoint(doc: EditorDoc, point: Point): Point {
  return {
    x: Math.max(0, Math.min(doc.width, point.x)),
    y: Math.max(0, Math.min(doc.height, point.y)),
  };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Replace the rectangular crop frame; at least a few pixels on each side. */
export function setCrop(doc: EditorDoc, a: Point, b: Point): EditorDoc {
  const start = clampPoint(doc, a);
  const end = clampPoint(doc, b);
  const rect = normalizeRect(start, end);
  if (rect.w < MIN_GESTURE_PIXELS || rect.h < MIN_GESTURE_PIXELS) return doc;
  return { ...doc, crop: { rect } };
}

function gestureLength(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Commit a drag as an arrow; tiny drags are ignored so taps stay clean. */
export function commitArrow(doc: EditorDoc, a: Point, b: Point): EditorDoc {
  const from = clampPoint(doc, a);
  const to = clampPoint(doc, b);
  if (gestureLength(from, to) < MIN_GESTURE_PIXELS) return doc;
  const shape: ArrowShape = { kind: "arrow", from, to };
  return { ...doc, shapes: [...doc.shapes, shape] };
}

/**
 * Add an ellipse highlight inscribed in the drag rectangle. It is an
 * annotation: the exported image stays whole, only an outline is drawn.
 */
export function placeEllipse(doc: EditorDoc, a: Point, b: Point): EditorDoc {
  const rect = normalizeRect(clampPoint(doc, a), clampPoint(doc, b));
  if (rect.w < MIN_GESTURE_PIXELS || rect.h < MIN_GESTURE_PIXELS) return doc;
  return { ...doc, shapes: [...doc.shapes, { kind: "ellipse", rect }] };
}

export function placeText(doc: EditorDoc, at: Point, text: string): EditorDoc {
  const trimmed = text.trim();
  if (!trimmed) return doc;
  const shape: TextShape = { kind: "text", at: clampPoint(doc, at), text: trimmed };
  return { ...doc, shapes: [...doc.shapes, shape] };
}

export function placeMarker(doc: EditorDoc, at: Point): EditorDoc {
  const number = doc.shapes.filter((shape) => shape.kind === "marker").length + 1;
  const shape: MarkerShape = { kind: "marker", at: clampPoint(doc, at), number };
  return { ...doc, shapes: [...doc.shapes, shape] };
}

/** Undo the last action: annotations first, then the crop frame. */
export function undo(doc: EditorDoc): EditorDoc {
  if (doc.shapes.length) return { ...doc, shapes: doc.shapes.slice(0, -1) };
  if (doc.crop) return { ...doc, crop: null };
  return doc;
}

export function resetDoc(doc: EditorDoc): EditorDoc {
  return doc.shapes.length || doc.crop ? { ...doc, shapes: [], crop: null } : doc;
}

export function canUndo(doc: EditorDoc): boolean {
  return doc.shapes.length > 0 || doc.crop !== null;
}

/** The source rectangle export reads from the decoded image. */
export function sourceRect(doc: EditorDoc): Rect {
  return doc.crop ? doc.crop.rect : { x: 0, y: 0, w: doc.width, h: doc.height };
}

export type ExportPlan = {
  source: Rect;
  width: number;
  height: number;
  scale: number;
  /** Annotation unit (stroke/font/radius) in output pixels. */
  unit: number;
};

/** Annotation unit scales with the (cropped) frame and stays readable. */
export function annotationUnit(rect: Rect): number {
  return Math.max(14, Math.min(64, Math.round(Math.min(rect.w, rect.h) / 24)));
}

/**
 * Flatten plan: the rectangular crop frame becomes the output canvas, and the
 * longest edge / pixel budget cap the output. Upscaling never happens.
 * Highlight ellipses are ordinary annotations and never clip the image.
 */
export function exportPlan(
  doc: EditorDoc,
  maxDimension = IMAGE_EXPORT_MAX_DIMENSION,
  maxPixels = IMAGE_EXPORT_MAX_PIXELS,
): ExportPlan {
  const source = sourceRect(doc);
  const dimensionScale = Math.min(1, maxDimension / source.w, maxDimension / source.h);
  const pixelScale = Math.min(1, Math.sqrt(maxPixels / (source.w * source.h)));
  const scale = Math.min(dimensionScale, pixelScale);
  const width = Math.max(1, Math.round(source.w * scale));
  const height = Math.max(1, Math.round(source.h * scale));
  return {
    source,
    width,
    height,
    scale,
    unit: Math.max(10, Math.round(annotationUnit(source) * scale)),
  };
}

export type DraftGesture =
  | { tool: "cropRect" | "ellipse" | "arrow"; from: Point; to: Point }
  | { tool: "marker" | "text"; at: Point };

/** Pointer-up commit for the active tool. Text content arrives separately. */
export function commitGesture(doc: EditorDoc, draft: DraftGesture, text = ""): EditorDoc {
  switch (draft.tool) {
    case "cropRect":
      return setCrop(doc, draft.from, draft.to);
    case "ellipse":
      return placeEllipse(doc, draft.from, draft.to);
    case "arrow":
      return commitArrow(doc, draft.from, draft.to);
    case "marker":
      return placeMarker(doc, draft.at);
    case "text":
      return placeText(doc, draft.at, text);
  }
}
