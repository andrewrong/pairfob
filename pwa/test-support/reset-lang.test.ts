import { expect, test } from "bun:test";
import { lang, setLang } from "../src/lib/i18n";

// Order matters: the second test only passes because the preload reset the language the first one changed.
test("a1 leaves the language on en", () => {
  setLang("en");
  expect(lang()).toBe("en");
});
test("a2 starts in zh because a preload resets it", () => {
  expect(lang()).toBe("zh");
});
