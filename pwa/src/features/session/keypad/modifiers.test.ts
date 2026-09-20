import { describe, expect, test } from "bun:test";
import { mapPadKey } from "./modifiers";

const none = { ctrl: false, alt: false, shift: false, cmd: false };

describe("pad key remap", () => {
  test("Ctrl or Cmd turns a letter into ctrl+letter and preserves modified arrows", () => {
    expect(mapPadKey("c", { ...none, ctrl: true })).toEqual(["ctrl+c"]);
    expect(mapPadKey("ctrl+a", { ...none, ctrl: true })).toEqual(["ctrl+a"]);
    expect(mapPadKey("k", { ...none, cmd: true })).toEqual(["ctrl+k"]);
    expect(mapPadKey("up", { ...none, ctrl: true })).toEqual(["ctrl+up"]);
  });

  test("Opt preserves terminal chords, Shift uppercases", () => {
    expect(mapPadKey("left", { ...none, alt: true })).toEqual(["alt+left"]);
    expect(mapPadKey("right", { ...none, alt: true })).toEqual(["alt+right"]);
    expect(mapPadKey("backspace", { ...none, alt: true })).toEqual(["alt+backspace"]);
    expect(mapPadKey("a", { ...none, shift: true })).toEqual(["A"]);
  });

  test("with no modifiers the token is unchanged", () => {
    expect(mapPadKey("enter", none)).toEqual(["enter"]);
  });
});
