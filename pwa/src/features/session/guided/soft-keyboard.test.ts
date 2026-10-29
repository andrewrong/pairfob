import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { unmountTestApp } from "../../../../test-support/react-harness";
import { releaseVisualViewport } from "../../../app/viewport";
import { setComposeFocused } from "../compose-store";
import { resetPaneView } from "../session-store";
import { finishSessionPaint } from "./view";

let realMatchMedia: typeof window.matchMedia;

function device(points: number, media: Record<string, boolean>): void {
  Object.defineProperty(navigator, "maxTouchPoints", { value: points, configurable: true });
  window.matchMedia = ((query: string) => ({ matches: media[query] ?? false, media: query })) as typeof window.matchMedia;
}

const IPAD = { "(pointer: coarse)": true, "(min-width: 900px)": true };
const DESKTOP = { "(pointer: coarse)": false, "(min-width: 900px)": true };

function composeInput(): HTMLTextAreaElement {
  const field = document.createElement("textarea");
  field.className = "full-terminal-compose-input";
  document.body.append(field);
  return field;
}

beforeEach(async () => {
  await resetBoardTestDOM();
  // A page mounted or a viewport bound by an earlier file reacts to every focus
  // in the shared document; this file measures focus alone.
  unmountTestApp();
  releaseVisualViewport();
  realMatchMedia = window.matchMedia;
  // An earlier file can leave the agent-chat page open; finishSessionPaint
  // returns before it touches the field then.
  resetPaneView();
  setComposeFocused(false);
});

afterEach(() => {
  setComposeFocused(false);
  document.body.querySelector(".full-terminal-compose-input")?.remove();
  window.matchMedia = realMatchMedia;
  delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
});

const SCROLL = { top: 0, left: 0, bottom: true };

describe("finishSessionPaint soft keyboard", () => {
  test("an iPad in landscape does not focus the compose field on paint", () => {
    device(5, IPAD);
    const field = composeInput();
    finishSessionPaint(SCROLL, field);
    expect(document.activeElement === field).toBe(false);
  });

  test("a desktop focuses the compose field on paint", () => {
    device(0, DESKTOP);
    const field = composeInput();
    finishSessionPaint(SCROLL, field);
    // Compare as a boolean: a failing toBe would pretty-print the whole DOM.
    expect(document.activeElement === field).toBe(true);
  });

  test("an iPad focuses the field again once the owner has tapped it", () => {
    device(5, IPAD);
    setComposeFocused(true);
    const field = composeInput();
    finishSessionPaint(SCROLL, field);
    // Compare as a boolean: a failing toBe would pretty-print the whole DOM.
    expect(document.activeElement === field).toBe(true);
  });
});
