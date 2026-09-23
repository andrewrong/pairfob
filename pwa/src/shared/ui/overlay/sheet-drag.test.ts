import { describe, expect, test } from "bun:test";
import { sheetDetentRelease, sheetRelease, sheetTravel } from "./sheet-drag.ts";

describe("sheet drag release", () => {
  const height = 400;

  test("a short slow drag springs back", () => {
    expect(sheetRelease(40, height, 0.1)).toBe("spring");
    expect(sheetRelease(99, height, 0.2)).toBe("spring");
  });

  test("a quarter of the sheet is far enough to mean dismiss", () => {
    expect(sheetRelease(101, height, 0)).toBe("close");
  });

  test("a flick closes even before a quarter", () => {
    expect(sheetRelease(24, height, 0.6)).toBe("close");
  });

  test("an upward drag never dismisses", () => {
    expect(sheetRelease(-120, height, 2)).toBe("spring");
  });

  test("upward travel is resisted and capped", () => {
    expect(sheetTravel(60)).toBe(60);
    expect(sheetTravel(-50)).toBeCloseTo(-11, 5);
    expect(sheetTravel(-400)).toBe(-34);
  });

  test("a collapsed sheet expands on a deliberate pull or an upward flick", () => {
    expect(sheetDetentRelease(-30, height, -0.1, false)).toBe("spring");
    expect(sheetDetentRelease(-60, height, -0.1, false)).toBe("expand");
    expect(sheetDetentRelease(-20, height, -0.8, false)).toBe("expand");
    expect(sheetDetentRelease(-200, height, -2, true)).toBe("spring");
  });

  test("an expanded sheet collapses where a collapsed one would close", () => {
    expect(sheetDetentRelease(150, height, 0, true)).toBe("collapse");
    expect(sheetDetentRelease(150, height, 0, false)).toBe("close");
    expect(sheetDetentRelease(40, height, 0.1, true)).toBe("spring");
  });
});
