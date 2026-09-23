import { happy, resetBoardTestDOM } from "../../../../test-support/dom";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bindSheetDrag } from "./sheet-drag.ts";

/** A phone-sized sheet whose form is taller than it can show, as on a phone. */
function mountSheet(scrollTop = 0): { dialog: HTMLDialogElement; form: HTMLElement; tile: HTMLElement } {
  const dialog = document.createElement("dialog");
  // Stands in for the form: the card that carries the transform and the scroll.
  const form = document.createElement("div");
  const tile = document.createElement("label");
  form.append(tile);
  dialog.append(form);
  document.body.append(dialog);
  Object.defineProperty(form, "scrollHeight", { configurable: true, value: 900 });
  Object.defineProperty(form, "clientHeight", { configurable: true, value: 500 });
  Object.defineProperty(form, "scrollTop", { configurable: true, value: scrollTop });
  return { dialog, form, tile };
}

function touch(target: Element, type: "touchstart" | "touchmove" | "touchend", y: number): Event {
  const event = new happy.Event(type, { bubbles: true, cancelable: true }) as unknown as Event;
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: 100, clientY: y }] });
  target.dispatchEvent(event);
  return event;
}

let release: (() => void) | null = null;

beforeEach(async () => {
  await resetBoardTestDOM();
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
});

afterEach(() => {
  release?.();
  release = null;
});

describe("sheet drag over a scrolling form", () => {
  test("an upward swipe on a form that can scroll scrolls instead of dragging the sheet", () => {
    const { dialog, form, tile } = mountSheet();
    release = bindSheetDrag({ dialog, form, scroller: form, close: () => {} });
    touch(tile, "touchstart", 600);
    const move = touch(tile, "touchmove", 520);
    expect(move.defaultPrevented).toBe(false);
    expect(form.classList.contains("is-sheet-dragging")).toBe(false);
  });

  test("a scrolled form scrolls back before the sheet follows a downward drag", () => {
    const { dialog, form, tile } = mountSheet(120);
    release = bindSheetDrag({ dialog, form, scroller: form, close: () => {} });
    touch(tile, "touchstart", 400);
    const move = touch(tile, "touchmove", 480);
    expect(move.defaultPrevented).toBe(false);
    expect(form.classList.contains("is-sheet-dragging")).toBe(false);
  });

  test("from the top, a downward drag still moves the sheet", () => {
    const { dialog, form, tile } = mountSheet();
    release = bindSheetDrag({ dialog, form, scroller: form, close: () => {} });
    touch(tile, "touchstart", 400);
    const move = touch(tile, "touchmove", 480);
    expect(move.defaultPrevented).toBe(true);
    expect(form.classList.contains("is-sheet-dragging")).toBe(true);
    touch(tile, "touchend", 480);
  });
});
