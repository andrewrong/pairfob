import { expect, test } from "bun:test";
import { encodeTerminalKey, requiresTerminalText } from "./terminal-keys";
import { mapPadKey } from "./modifiers";

const none = { ctrl: false, alt: false, shift: false, cmd: false };

test("all modified arrows retain the xterm modifier bit mask in both cursor modes", () => {
  for (const [key, final] of Object.entries({ up: "A", down: "B", right: "C", left: "D" })) {
    for (let bits = 1; bits <= 7; bits++) {
      const flags = { ...none, shift: !!(bits & 1), alt: !!(bits & 2), ctrl: !!(bits & 4) };
      const mapped = mapPadKey(key, flags);
      expect(mapped).toHaveLength(1);
      expect(requiresTerminalText(mapped[0])).toBe(true);
      for (const application of [false, true]) expect(encodeTerminalKey(mapped[0], application)).toBe(`\x1b[1;${bits + 1}${final}`);
    }
    expect(encodeTerminalKey(key)).toBe(`\x1b[${final}`);
    expect(encodeTerminalKey(key, true)).toBe(`\x1bO${final}`);
  }
});

test("editing chords preserve legacy terminal bytes without substituting readline commands", () => {
  for (const [chord, bytes] of Object.entries({
    "alt+up": "\x1b[1;3A", "shift+tab": "\x1b[Z", "alt+backspace": "\x1b\x7f",
    "ctrl+backspace": "\b", "ctrl+alt+backspace": "\x1b\b", "alt+enter": "\x1b\r",
    "alt+esc": "\x1b\x1b", "ctrl+alt+c": "\x1b\x03", "alt+shift+c": "\x1bC",
  })) expect(encodeTerminalKey(chord)).toBe(bytes);
  expect(mapPadKey("ctrl+c", { ...none, alt: true })).toEqual(["ctrl+alt+c"]);
  expect(mapPadKey("up", { ...none, cmd: true, alt: true })).toEqual(["ctrl+alt+up"]);
  expect(requiresTerminalText("ctrl+c")).toBe(false);
  expect(requiresTerminalText("+")).toBe(false);
  for (const key of ["alt+unknown", "constructor", "__proto__"]) expect(encodeTerminalKey(key)).toBe("");
});
