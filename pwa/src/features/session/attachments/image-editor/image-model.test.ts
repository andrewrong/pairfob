import { describe, expect, test } from "bun:test";
import {
  IMAGE_EXPORT_MAX_DIMENSION,
  IMAGE_EXPORT_MAX_PIXELS,
  annotationUnit,
  canUndo,
  commitArrow,
  commitGesture,
  createDoc,
  exportPlan,
  normalizeRect,
  placeEllipse,
  placeMarker,
  placeText,
  resetDoc,
  setCrop,
  sourceRect,
  undo,
  type EditorDoc,
} from "./image-model";

function doc(): EditorDoc {
  return createDoc(1000, 500);
}

describe("editor document", () => {
  test("requires positive dimensions", () => {
    expect(() => createDoc(0, 10)).toThrow(RangeError);
    expect(() => createDoc(-1, 10)).toThrow(RangeError);
  });

  test("normalizes and clamps the rectangular crop", () => {
    expect(normalizeRect({ x: 9, y: 8 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 3, w: 7, h: 5 });
    const cropped = setCrop(doc(), { x: 900, y: 600 }, { x: 100, y: 100 });
    expect(cropped.crop?.rect).toEqual({ x: 100, y: 100, w: 800, h: 400 });
  });

  test("ignores tiny crop and arrow drags", () => {
    expect(setCrop(doc(), { x: 0, y: 0 }, { x: 3, y: 3 }).crop).toBeNull();
    expect(commitArrow(doc(), { x: 0, y: 0 }, { x: 2, y: 2 }).shapes).toHaveLength(0);
  });

  test("replaces the crop frame instead of stacking them", () => {
    const first = setCrop(doc(), { x: 0, y: 0 }, { x: 400, y: 400 });
    const second = setCrop(first, { x: 10, y: 10 }, { x: 300, y: 300 });
    expect(second.crop?.rect).toEqual({ x: 10, y: 10, w: 290, h: 290 });
  });

  test("the ellipse tool is a highlight annotation, not a crop: the whole image is preserved", () => {
    const highlighted = placeEllipse(doc(), { x: 10, y: 20 }, { x: 210, y: 120 });
    expect(highlighted.crop).toBeNull();
    expect(highlighted.shapes).toEqual([{
      kind: "ellipse",
      rect: { x: 10, y: 20, w: 200, h: 100 },
    }]);
    // Export reads the full source even with an ellipse present.
    expect(sourceRect(highlighted)).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
  });

  test("an ellipse plus a crop coexist: crop bounds output, ellipse annotates it", () => {
    let current = placeEllipse(doc(), { x: 0, y: 0 }, { x: 200, y: 100 });
    current = setCrop(current, { x: 50, y: 40 }, { x: 250, y: 240 });
    expect(current.shapes).toHaveLength(1);
    expect(current.crop?.rect).toEqual({ x: 50, y: 40, w: 200, h: 200 });
  });

  test("ignores tiny ellipse drags", () => {
    expect(placeEllipse(doc(), { x: 0, y: 0 }, { x: 4, y: 4 }).shapes).toHaveLength(0);
  });

  test("places text only when non-empty and numbers markers in order", () => {
    expect(placeText(doc(), { x: 5, y: 5 }, "   ").shapes).toHaveLength(0);
    const withText = placeText(doc(), { x: 5, y: 5 }, " hi ");
    expect(withText.shapes[0]).toMatchObject({ kind: "text", text: "hi" });
    const m1 = placeMarker(withText, { x: 10, y: 10 });
    const m2 = placeMarker(m1, { x: 20, y: 20 });
    expect(m2.shapes.filter((s) => s.kind === "marker").map((s) => s.kind === "marker" && s.number)).toEqual([1, 2]);
  });

  test("undo pops annotations (ellipse included) before the crop and reset clears all", () => {
    let current = commitArrow(doc(), { x: 0, y: 0 }, { x: 100, y: 100 });
    current = placeEllipse(current, { x: 0, y: 0 }, { x: 100, y: 100 });
    current = setCrop(current, { x: 0, y: 0 }, { x: 200, y: 200 });
    expect(canUndo(current)).toBe(true);
    const afterUndo1 = undo(current);
    expect(afterUndo1.shapes).toHaveLength(1);
    expect(afterUndo1.shapes[0].kind).toBe("arrow");
    expect(afterUndo1.crop).not.toBeNull();
    const afterUndo2 = undo(afterUndo1);
    expect(afterUndo2.shapes).toHaveLength(0);
    expect(afterUndo2.crop).not.toBeNull();
    const afterUndo3 = undo(afterUndo2);
    expect(afterUndo3.crop).toBeNull();
    expect(canUndo(afterUndo3)).toBe(false);
    expect(resetDoc(current).crop).toBeNull();
    expect(resetDoc(current).shapes).toHaveLength(0);
  });

  test("commitGesture dispatches pointer-up gestures", () => {
    const marked = commitGesture(doc(), { tool: "marker", at: { x: 10, y: 10 } });
    expect(marked.shapes[0]).toMatchObject({ kind: "marker", number: 1 });
    const texted = commitGesture(doc(), { tool: "text", at: { x: 10, y: 10 } }, "label");
    expect(texted.shapes[0]).toMatchObject({ kind: "text", text: "label" });
    const ellipsed = commitGesture(doc(), { tool: "ellipse", from: { x: 0, y: 0 }, to: { x: 90, y: 60 } });
    expect(ellipsed.shapes[0]).toMatchObject({ kind: "ellipse" });
    expect(ellipsed.crop).toBeNull();
  });
});

describe("export plan", () => {
  test("exports the full frame 1:1 without edits upscale", () => {
    const plan = exportPlan(doc());
    expect(plan.source).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    expect(plan).toMatchObject({ width: 1000, height: 500, scale: 1 });
    expect(plan.unit).toBe(annotationUnit(plan.source));
  });

  test("uses the rectangular crop as source and keeps its aspect", () => {
    const cropped = setCrop(doc(), { x: 100, y: 50 }, { x: 300, y: 250 });
    const plan = exportPlan(cropped);
    expect(plan.source).toEqual({ x: 100, y: 50, w: 200, h: 200 });
    expect(plan).toMatchObject({ width: 200, height: 200 });
  });

  test("an ellipse never changes export bounds", () => {
    const highlighted = placeEllipse(doc(), { x: 100, y: 50 }, { x: 300, y: 250 });
    const plan = exportPlan(highlighted);
    expect(plan.source).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    expect(plan).toMatchObject({ width: 1000, height: 500 });
  });

  test("caps the longest edge", () => {
    const plan = exportPlan(createDoc(8000, 2000));
    expect(plan.width).toBeLessThanOrEqual(IMAGE_EXPORT_MAX_DIMENSION);
    expect(plan.height).toBeLessThanOrEqual(IMAGE_EXPORT_MAX_DIMENSION);
    expect(plan.width).toBe(IMAGE_EXPORT_MAX_DIMENSION);
    expect(plan.scale).toBeCloseTo(0.512, 5);
  });

  test("caps total pixels for very large images", () => {
    const plan = exportPlan(createDoc(10000, 10000));
    expect(plan.width * plan.height).toBeLessThanOrEqual(IMAGE_EXPORT_MAX_PIXELS);
    expect(plan.scale).toBeCloseTo(Math.sqrt(IMAGE_EXPORT_MAX_PIXELS / 1e8), 4);
  });

  test("source rect defaults to the full image", () => {
    expect(sourceRect(doc())).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
  });
});
