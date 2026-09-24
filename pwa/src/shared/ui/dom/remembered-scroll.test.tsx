import { happy, resetBoardTestDOM } from "../../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRememberedScroll } from "./remembered-scroll";

function Page({ name, enabled = true }: { name: string; enabled?: boolean }) {
  useRememberedScroll(name, enabled);
  return createElement("div");
}

let root: Root;

function show(name: string, enabled = true): void {
  act(() => root.render(createElement(Page, { key: name, name, enabled })));
}

// The document scroller is owned here, not by whatever an earlier suite left
// on the shared window: a plain offset the hook writes and reads back.
let offset = 0;
const realScrollTo = window.scrollTo;
const realScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

function scrollTo(y: number): void {
  offset = y;
  window.dispatchEvent(new happy.Event("scroll"));
}

beforeEach(async () => {
  await resetBoardTestDOM();
  offset = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => offset });
  window.scrollTo = ((_x: number, y: number) => { offset = y; }) as typeof window.scrollTo;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  window.scrollTo = realScrollTo;
  if (realScrollY) Object.defineProperty(window, "scrollY", realScrollY);
  else delete (window as { scrollY?: number }).scrollY;
});

test("each page returns to its own offset", () => {
  show("list");
  scrollTo(640);
  show("settings");
  expect(window.scrollY).toBe(0);
  scrollTo(120);
  show("list");
  expect(window.scrollY).toBe(640);
  show("settings");
  expect(window.scrollY).toBe(120);
  act(() => root.unmount());
});

test("a disabled page neither restores nor records", () => {
  show("rail", false);
  scrollTo(300);
  show("other");
  show("rail", false);
  expect(window.scrollY).toBe(0);
  act(() => root.unmount());
});
