import { afterEach, beforeEach, expect, test } from "bun:test";
import { happy, resetBoardTestDOM } from "../../../../test-support/dom";
import { bindModifier, clearModifiers, MODIFIER_DOUBLE_TAP_MS, modifierIsLocked, withModifiers } from "./keypad";
import { bindModifierScope } from "./modifier-scope";
import { selectPane, setFullTerminal } from "../session-store";
import { attachLiveSession } from "../../computers/catalog-store";
import type { LiveSession } from "../../../lib/protocol/session-types";

const cleanup: Array<() => void> = [];
beforeEach(async () => { await resetBoardTestDOM(); clearModifiers(); });
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  clearModifiers(); selectPane(""); setFullTerminal(false); attachLiveSession(null);
});
const wait = () => new Promise(resolve => setTimeout(resolve, MODIFIER_DOUBLE_TAP_MS + 40));
function button() {
  const el = document.createElement("button");
  document.body.append(el);
  cleanup.push(bindModifier(el, "alt").destroy, () => el.remove());
  return (type: string) => el.dispatchEvent(new happy.PointerEvent(type, { pointerId: 1, button: 0, bubbles: true }));
}
async function lock() {
  const pointer = button();
  pointer("pointerdown"); pointer("pointerup");
  pointer("pointerdown"); pointer("pointerup");
  expect(modifierIsLocked("alt")).toBe(true);
  return pointer;
}

test("double tap locks across repeated keys; tapping unlocks without leaving a one-shot latch", async () => {
  const pointer = await lock();
  expect(withModifiers("up")).toEqual(["alt+up"]);
  expect(withModifiers("up")).toEqual(["alt+up"]);
  pointer("pointerdown"); pointer("pointerup"); pointer("lostpointercapture");
  expect(modifierIsLocked("alt")).toBe(false);
  expect(withModifiers("up")).toEqual(["up"]);
});

test("a long press never locks, and two slow taps only toggle the one-shot latch", async () => {
  const pointer = button();
  pointer("pointerdown"); await wait(); pointer("pointerup");
  expect(modifierIsLocked("alt")).toBe(false);
  expect(withModifiers("up")).toEqual(["alt+up"]);
  pointer("pointerdown"); pointer("pointerup"); await wait();
  pointer("pointerdown"); pointer("pointerup");
  expect(modifierIsLocked("alt")).toBe(false);
  expect(withModifiers("up")).toEqual(["up"]);
});

test("cancelled second tap cannot lock, and using the first tap breaks the double tap", () => {
  const pointer = button();
  pointer("pointerdown"); pointer("pointerup");
  pointer("pointerdown"); pointer("pointercancel");
  expect(modifierIsLocked("alt")).toBe(false);
  expect(withModifiers("up")).toEqual(["alt+up"]);
  pointer("pointerdown"); pointer("pointerup");
  expect(modifierIsLocked("alt")).toBe(false);
  expect(withModifiers("up")).toEqual(["alt+up"]);
});

test("using a held modifier with another finger does not turn it into a lock", async () => {
  const pointer = button(); pointer("pointerdown");
  expect(withModifiers("up")).toEqual(["alt+up"]);
  await wait(); pointer("pointerup");
  expect(modifierIsLocked("alt")).toBe(false);
  expect(withModifiers("up")).toEqual(["up"]);
});

for (const boundary of ["pane", "session", "mode", "blur", "hidden", "unmount"] as const) {
  test(`lock clears on ${boundary}`, async () => {
    selectPane("p1"); setFullTerminal(false);
    const stop = bindModifierScope(document); cleanup.push(stop);
    const pointer = await lock();
    if (boundary === "pane") selectPane("p2");
    if (boundary === "session") attachLiveSession({} as LiveSession);
    if (boundary === "mode") setFullTerminal(true);
    if (boundary === "blur") window.dispatchEvent(new happy.Event("blur"));
    if (boundary === "hidden") {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new happy.Event("visibilitychange"));
      delete (document as unknown as Record<string, unknown>).hidden;
    }
    if (boundary === "unmount") stop();
    pointer("pointerup");
    expect(modifierIsLocked("alt")).toBe(false);
    expect(withModifiers("up")).toEqual(["up"]);
  });
}
