import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { happy, resetBoardTestDOM } from "../../test-support/dom";

await resetBoardTestDOM();
Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
const telemetry = await import("../lib/telemetry");
telemetry.setTelemetrySender(() => {});
const { startApplication, stopApplication, applicationIsRunning } = await import("./bootstrap");
const { subscribeAppFrame } = await import("./frame");

afterEach(async () => {
  if (applicationIsRunning()) await act(async () => { stopApplication(); });
  telemetry.resetTelemetry();
});

test("bootstrap applies the stored text size before the app first renders", async () => {
  localStorage.setItem("pairfob:textSize", "xlarge");
  document.documentElement.style.fontSize = "";
  let atFirstFrame: string | null = null;
  const off = subscribeAppFrame(() => { atFirstFrame ??= document.documentElement.style.fontSize; });
  await act(async () => { startApplication(); });
  off();
  expect(document.documentElement.style.fontSize).toBe("20px");
  expect(atFirstFrame as string | null).toBe("20px");
  localStorage.removeItem("pairfob:textSize");
  void happy;
});
