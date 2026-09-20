import { beforeEach, expect, test } from "bun:test";
import "../../../../test-support/boot-dom";
import { captureTraceViewport, restoreTraceViewport } from "./viewport";

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON() {} };
}

beforeEach(() => {
  document.body.innerHTML = `<div id="stream">
    <div data-trace-anchor="first"></div>
    <div data-trace-anchor="kept"></div>
    <div data-trace-anchor="last"></div>
  </div>`;
});

test("restores the first visible transcript anchor through a prepend", () => {
  const stream = document.querySelector<HTMLElement>("#stream")!;
  const [first, kept, last] = [...stream.querySelectorAll<HTMLElement>("[data-trace-anchor]")];
  stream.getBoundingClientRect = () => rect(100, 200);
  first.getBoundingClientRect = () => rect(20, 80);
  kept.getBoundingClientRect = () => rect(130, 80);
  last.getBoundingClientRect = () => rect(210, 80);
  stream.scrollTop = 400;

  const viewport = captureTraceViewport(stream, false, true);
  expect(viewport).toMatchObject({ anchor: "kept", offset: 30, scrollTop: 400, follow: false, unread: true });

  kept.getBoundingClientRect = () => rect(330, 80);
  expect(restoreTraceViewport(stream, viewport)).toBeTrue();
  expect(stream.scrollTop).toBe(600);
});

test("tail-follow restores the newest output instead of a stale anchor", () => {
  const stream = document.querySelector<HTMLElement>("#stream")!;
  Object.defineProperty(stream, "scrollHeight", { configurable: true, value: 900 });
  stream.scrollTop = 80;
  expect(restoreTraceViewport(stream, {
    anchor: "kept", offset: 20, scrollTop: 80, follow: true, unread: false,
  })).toBeTrue();
  expect(stream.scrollTop).toBe(900);
});
