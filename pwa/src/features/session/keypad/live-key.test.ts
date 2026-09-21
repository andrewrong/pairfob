import { afterEach, expect, test } from "bun:test";
import { clearModifiers, pressModifier, releaseModifier } from "./keypad";
import { encodeLiveKey } from "./live-key";

afterEach(clearModifiers);
test("one-shot Opt applies to the next real-time character only", () => {
  pressModifier("alt"); releaseModifier("alt");
  expect(encodeLiveKey("b")).toBe("\x1bb");
  expect(encodeLiveKey("f")).toBe("f");
});
test("held modifiers work across characters and combine", () => {
  pressModifier("ctrl"); pressModifier("alt");
  expect(encodeLiveKey("c")).toBe("\x1b\x03");
  expect(encodeLiveKey("a")).toBe("\x1b\x01");
});
test("IME, multi-character paste and encoded keys preserve pending modifiers", () => {
  pressModifier("alt"); releaseModifier("alt");
  for (const text of ["中文", "你", "paste", "\x1b[1;3A", "\x03"]) expect(encodeLiveKey(text)).toBe(text);
  expect(encodeLiveKey("f")).toBe("\x1bf");
});

test("Ctrl+] sends GS once instead of falling back to a literal bracket", () => {
  pressModifier("ctrl"); releaseModifier("ctrl");
  expect(encodeLiveKey("]")).toBe("\x1d");
  expect(encodeLiveKey("]")).toBe("]");
});
