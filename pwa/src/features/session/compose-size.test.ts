import { describe, expect, test } from "bun:test";
import { COMPOSE_MIN_PX } from "./compose-store";
import { COMPOSE_FRAME_PX, COMPOSE_LINE_PX, composeMaxPx, draftLineCount, type ComposeRoom } from "./compose-size";

const room = (patch: Partial<ComposeRoom>): ComposeRoom => ({
  viewport: 800,
  header: 56,
  dockChrome: 150,
  termRow: 18,
  line: COMPOSE_LINE_PX,
  frame: COMPOSE_FRAME_PX,
  ...patch,
});
const fourLines = COMPOSE_FRAME_PX + 4 * COMPOSE_LINE_PX;

describe("compose max height", () => {
  test("a tall screen caps the field at 40% of the visual viewport", () => {
    expect(composeMaxPx(room({ viewport: 800 }))).toBe(320);
  });

  test("keyboard up: six terminal rows stay visible under the header and dock", () => {
    // 480 − 56 − 150 − 6 × 18 = 166, below 40 % (192).
    expect(composeMaxPx(room({ viewport: 480 }))).toBe(166);
  });

  test("four lines stay available when the screen has room for them", () => {
    // 40 % would be 136 and six rows leave 84: four lines still fit above three rows.
    const max = composeMaxPx(room({ viewport: 340, dockChrome: 90 }));
    expect(max).toBe(Math.floor(fourLines));
  });

  test("never smaller than one line", () => {
    expect(composeMaxPx(room({ viewport: 200, dockChrome: 190 }))).toBe(COMPOSE_MIN_PX);
  });

  test("line count follows logical lines", () => {
    expect(draftLineCount("")).toBe(0);
    expect(draftLineCount("one")).toBe(1);
    expect(draftLineCount("a\nb\n")).toBe(3);
  });
});
