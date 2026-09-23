import { describe, expect, test } from "bun:test";

const source = await Bun.file(new URL("./operation-form.tsx", import.meta.url)).text();

describe("operation sheet drag", () => {
  // On a phone the form carries the card and its scroll (see overlay.scss); a
  // drag bound to the non-scrolling dialog treated every upward swipe on a tall
  // form as a sheet drag and the bottom actions could not be reached.
  test("the drag reads the form, the element that really scrolls", () => {
    expect(source).toContain("scroller: modal.form.current");
    expect(source).not.toContain("scroller: modal.dialog.current");
  });
});
