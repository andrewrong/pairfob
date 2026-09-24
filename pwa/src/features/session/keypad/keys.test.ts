import { describe, expect, test } from "bun:test";
import { EXPANDED_KEYS, EXTRA_KEYS, KEY_PAGES, PRIMARY_KEYS, keyAriaName, keycapOf } from "./keys";
import { mapPadKey } from "./modifiers";

const none = { ctrl: false, alt: false, shift: false, cmd: false };

describe("pad key tables", () => {
  test("pages are grouped by purpose and fill exactly two rows of seven", () => {
    expect(KEY_PAGES.map((page) => page.name)).toEqual(["pad.pageControl", "pad.pageEdit"]);
    expect(EXPANDED_KEYS.map((key) => key.key)).toEqual([
      "ctrl", "alt", "shift", "cmd", "tab", "shift+tab", "enter",
      "ctrl+c", "ctrl+d", "ctrl+z", "ctrl+l", "ctrl+r", "ctrl+u", "ctrl+w",
    ]);
    expect(EXTRA_KEYS.map((key) => key.key)).toEqual([
      "1", "2", "3", "4", "5", "y", "n",
      "space", "ctrl+a", "ctrl+e", "ctrl+k", "ctrl+y", "alt+b", "alt+f",
    ]);
    expect(PRIMARY_KEYS).toHaveLength(6);
  });

  test("every non-modifier pad key is encodable by the key path", () => {
    for (const spec of [...PRIMARY_KEYS, ...EXPANDED_KEYS, ...EXTRA_KEYS]) {
      if (spec.modifier) continue;
      expect(mapPadKey(spec.key, none), spec.key).toEqual([spec.key]);
    }
  });

  test("keycaps are glyphs, words or two-line chords with a full spoken name", () => {
    const cap = (key: string) => keycapOf([...PRIMARY_KEYS, ...EXPANDED_KEYS, ...EXTRA_KEYS].find((spec) => spec.key === key)!);
    expect(cap("y")).toEqual({ kind: "glyph", text: "Y" });
    expect(cap("backspace")).toEqual({ kind: "glyph", text: "⌫" });
    expect(cap("esc")).toEqual({ kind: "word", text: "Esc" });
    expect(cap("alt")).toEqual({ kind: "word", text: "Alt" });
    expect(cap("ctrl+c")).toEqual({ kind: "chord", modifier: "Ctrl", text: "C", word: false });
    expect(cap("shift+tab")).toEqual({ kind: "chord", modifier: "Shift", text: "Tab", word: true });
    expect(cap("alt+b")).toEqual({ kind: "chord", modifier: "Alt", text: "B", word: false });
    expect(keyAriaName({ key: "ctrl+w" })).toBe("Ctrl+W");
    expect(keyAriaName({ key: "shift+tab" })).toBe("Shift+Tab");
    // No ⌃ / ⌥ / ⇧ symbols: they are missing from some fonts and unknown off a Mac.
    for (const spec of [...EXPANDED_KEYS, ...EXTRA_KEYS]) expect(JSON.stringify(keycapOf(spec))).not.toMatch(/[⌃⌥⇧⌘]/);
  });
});
