import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { appRoot } from "../../../app/dom-root";
import { bindCommandDrag, COMMAND_DRAG_FLIP_MS } from "./command-drag";

/** happy-dom has no layout; give each cell a 50px slot on one row. */
function slot(el: Element, left: number, top = 0): void {
  el.getBoundingClientRect = () => ({ left, top, right: left + 50, bottom: top + 44, width: 50, height: 44, x: left, y: top } as DOMRect);
}

function fixture() {
  const pages = document.createElement("div");
  pages.className = "pad-pages";
  pages.innerHTML = `<div class="pad-page">
    <div data-pad-index="0"><button id="own">A</button></div>
    <span data-pad-index="1">/clear</span>
    <span data-pad-index="2">/new</span>
  </div><button data-pad-dot="0" aria-current="page"></button><button data-pad-dot="1"></button>`;
  appRoot().append(pages);
  const cells = [...pages.querySelectorAll("[data-pad-index]")];
  cells.forEach((cell, index) => slot(cell, index * 50));
  const own = pages.querySelector<HTMLButtonElement>("#own")!;
  slot(own, 0);
  const dots = [...pages.querySelectorAll<HTMLButtonElement>("[data-pad-dot]")];
  dots.forEach((dot, index) => slot(dot, index * 60, 100));
  return { own, dots };
}

function pointer(target: EventTarget, type: string, x: number, y = 10) {
  const view = appRoot().ownerDocument.defaultView!;
  target.dispatchEvent(new view.PointerEvent(type, { pointerId: 3, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
}

let dispose: (() => void) | null = null;
beforeEach(async () => { await resetBoardTestDOM(); });
afterEach(() => { dispose?.(); dispose = null; appRoot().replaceChildren(); });

test("a drag drops on the cell under the finger and swallows the click", () => {
  const { own } = fixture();
  const drops: number[] = [];
  dispose = bindCommandDrag(own, to => drops.push(to));
  let clicks = 0;
  own.addEventListener("click", () => clicks++);
  pointer(own, "pointerdown", 10);
  pointer(document, "pointermove", 60);
  expect(document.querySelector(".pad-drag-ghost")).toBeTruthy();
  expect(document.querySelector('[data-pad-index="1"]')!.classList.contains("is-drop-target")).toBeTrue();
  pointer(document, "pointermove", 120);
  pointer(document, "pointerup", 120);
  own.click();
  expect(drops).toEqual([2]);
  expect(clicks).toBe(0);
  expect(document.querySelector(".pad-drag-ghost")).toBeNull();
  expect(document.querySelector(".is-drop-target")).toBeNull();
});

test("a short press stays a tap, and a cancelled drag drops nothing", () => {
  const { own } = fixture();
  const drops: number[] = [];
  dispose = bindCommandDrag(own, to => drops.push(to));
  let clicks = 0;
  own.addEventListener("click", () => clicks++);
  pointer(own, "pointerdown", 10);
  pointer(document, "pointermove", 14);
  pointer(document, "pointerup", 14);
  own.click();
  expect(clicks).toBe(1);
  pointer(own, "pointerdown", 10);
  pointer(document, "pointermove", 110);
  pointer(document, "pointercancel", 110);
  expect(drops).toEqual([]);
  expect(document.querySelector(".pad-drag-ghost")).toBeNull();
});

test("resting on another page's dot turns the page under the dragged command", async () => {
  const { own, dots } = fixture();
  dispose = bindCommandDrag(own, () => undefined);
  let flipped = 0;
  dots[1]!.addEventListener("click", () => flipped++);
  pointer(own, "pointerdown", 10);
  pointer(document, "pointermove", 20, 60);
  pointer(document, "pointermove", 80, 110);
  await new Promise(resolve => setTimeout(resolve, COMMAND_DRAG_FLIP_MS + 60));
  expect(flipped).toBe(1);
  pointer(document, "pointerup", 80, 110);
});
