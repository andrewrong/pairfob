import { beforeEach, describe, expect, test } from "bun:test";
import { resetTestDOM } from "../../../test-support/boot-dom";
import {
  CREATE_MEMORY_KEY,
  favoriteKinds,
  loadCreateMemory,
  parseCreateMemory,
  rememberCreate,
  togglePinnedKind,
} from "./create-memory";
import { LAST_AGENT_KIND_KEY } from "./operation-form-model";

beforeEach(async () => {
  await resetTestDOM();
  localStorage.clear();
});

describe("create memory", () => {
  test("malformed storage falls back to an empty memory instead of failing", () => {
    expect(parseCreateMemory(null)).toEqual({ pinned: [], uses: {}, lastUsed: {}, recents: [], dirs: [] });
    expect(parseCreateMemory("{not json")).toEqual({ pinned: [], uses: {}, lastUsed: {}, recents: [], dirs: [] });
    const parsed = parseCreateMemory(JSON.stringify({
      pinned: ["claude", 3, "", "claude"],
      uses: { codex: 2, bad: -1, worse: "x" },
      recents: [{ kind: "codex", workspaceId: "w1" }, { kind: 1 }, { kind: "", workspaceId: "w2" }],
      dirs: ["~/a", 4, ""],
    }));
    expect(parsed.pinned).toEqual(["claude"]);
    expect(parsed.uses).toEqual({ codex: 2 });
    expect(parsed.recents).toEqual([{ kind: "codex", workspaceId: "w1" }, { kind: "", workspaceId: "w2" }]);
    expect(parsed.dirs).toEqual(["~/a"]);
  });

  test("a confirmed create counts the kind, keeps three recent combinations and five directories", () => {
    for (const [kind, workspaceId] of [["claude", "w1"], ["codex", "w2"], ["", "w1"], ["claude", "w3"], ["claude", "w1"]]) {
      rememberCreate({ kind, workspaceId }, 100);
    }
    for (const cwd of ["~/1", "~/2", "~/3", "~/4", "~/5", "~/6", "~/2"]) rememberCreate({ kind: "claude", cwd }, 100);
    const memory = loadCreateMemory();
    expect(memory.uses).toEqual({ claude: 10, codex: 1 });
    expect(memory.lastUsed.claude).toBe(100);
    expect(memory.recents).toEqual([
      { kind: "claude", workspaceId: "w1" },
      { kind: "claude", workspaceId: "w3" },
      { kind: "", workspaceId: "w1" },
    ]);
    expect(memory.dirs).toEqual(["~/2", "~/6", "~/5", "~/4", "~/3"]);
    // The existing last-kind preference stays in step for the older forms.
    expect(localStorage.getItem(LAST_AGENT_KIND_KEY)).toBe("claude");
    expect(JSON.parse(localStorage.getItem(CREATE_MEMORY_KEY)!).uses.claude).toBe(10);
  });

  test("pins toggle and persist", () => {
    expect(togglePinnedKind("gemini").pinned).toEqual(["gemini"]);
    expect(loadCreateMemory().pinned).toEqual(["gemini"]);
    expect(togglePinnedKind("gemini").pinned).toEqual([]);
  });

  test("the grid shows pinned kinds first, then by use, and only advertised kinds", () => {
    const memory = { pinned: ["gemini", "retired"], uses: { codex: 9, claude: 3, amp: 1 }, lastUsed: {}, recents: [], dirs: [] };
    const advertised = ["claude", "codex", "gemini", "amp", "goose", "kimi", "qwen", "pi"];
    // Six slots: with the terminal and "all" the grid fills two rows of four.
    expect(favoriteKinds(advertised, memory)).toEqual(["gemini", "codex", "claude", "amp", "goose", "kimi"]);
    // A kind chosen from the full list takes the last slot.
    expect(favoriteKinds(advertised, memory, "pi")).toEqual(["gemini", "codex", "claude", "amp", "goose", "pi"]);
    // A kind the computer no longer offers never appears, pinned or not.
    expect(favoriteKinds(["claude"], memory, "retired")).toEqual(["claude"]);
  });
});
