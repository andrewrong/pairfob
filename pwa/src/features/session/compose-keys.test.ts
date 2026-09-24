import { describe, expect, test } from "bun:test";
import { withQuickCommand, withSlashCommand } from "./compose-keys";

describe("quick command insertion", () => {
  test("fills an empty draft", () => {
    expect(withQuickCommand("", 0, 0, "review")).toEqual({ next: "review", caret: 6 });
  });

  test("keeps words on both sides of the caret apart", () => {
    expect(withQuickCommand("AB", 1, 1, "review")).toEqual({ next: "A review B", caret: 8 });
  });

  test("adds no extra space next to existing whitespace", () => {
    expect(withQuickCommand("A B", 2, 2, "review")).toEqual({ next: "A review B", caret: 8 });
    expect(withQuickCommand("A", 1, 1, "review")).toEqual({ next: "A review", caret: 8 });
  });
});

describe("slash command insertion", () => {
  test("goes to the start and keeps the draft", () => {
    expect(withSlashCommand("fix the header", "/goal ").startsWith("/goal fix the header")).toBe(true);
  });
});
