import { describe, expect, test } from "bun:test";
import type { GitChange } from "../../lib/workspace";
import { changeSections, fileNameProblem, foldBreadcrumbs, gitMarks, isConflict, layersFor, reviewOrder } from "./git-marks";

const change = (path: string, index: string, worktree: string): GitChange => ({ path, original_path: null, index, worktree });

const CHANGES = [
  change("pwa/bun.lock", "U", "U"),
  change("pwa/src/lib/workspace.ts", "M", " "),
  change("pwa/src/features/workspace/model.ts", "M", "M"),
  change("pwa/src/features/workspace/files.tsx", " ", "M"),
  change("pwa/src/features/workspace/new.tsx", "?", "?"),
  change("README.md", " ", "D"),
];

describe("git marks", () => {
  test("conflicts include both-added and both-deleted pairs", () => {
    expect(isConflict(change("a", "U", "U"))).toBe(true);
    expect(isConflict(change("a", "A", "A"))).toBe(true);
    expect(isConflict(change("a", "D", "D"))).toBe(true);
    expect(isConflict(change("a", "A", "M"))).toBe(false);
    expect(isConflict(change("a", "?", "?"))).toBe(false);
  });

  test("sections list a conflict once and split staged from worktree", () => {
    const sections = changeSections(CHANGES);
    expect(sections.conflict.map((step) => step.path)).toEqual(["pwa/bun.lock"]);
    expect(sections.staged.map((step) => step.path)).toEqual(["pwa/src/lib/workspace.ts", "pwa/src/features/workspace/model.ts"]);
    expect(sections.worktree.map((step) => `${step.path}:${step.kind}`)).toEqual([
      "pwa/src/features/workspace/model.ts:modified",
      "pwa/src/features/workspace/files.tsx:modified",
      "pwa/src/features/workspace/new.tsx:untracked",
      "README.md:deleted",
    ]);
  });

  test("review order walks conflicts, then staged, then worktree", () => {
    expect(reviewOrder(CHANGES).map((step) => `${step.layer}:${step.path}`)).toEqual([
      "worktree:pwa/bun.lock",
      "staged:pwa/src/lib/workspace.ts",
      "staged:pwa/src/features/workspace/model.ts",
      "worktree:pwa/src/features/workspace/model.ts",
      "worktree:pwa/src/features/workspace/files.tsx",
      "worktree:pwa/src/features/workspace/new.tsx",
      "worktree:README.md",
    ]);
  });

  test("a path offers the layers it changed in; a conflict only the worktree", () => {
    expect(layersFor(CHANGES, "pwa/src/features/workspace/model.ts")).toEqual(["staged", "worktree"]);
    expect(layersFor(CHANGES, "pwa/bun.lock")).toEqual(["worktree"]);
    expect(layersFor(CHANGES, "missing")).toEqual([]);
  });

  test("files show their worktree mark and every ancestor directory counts them", () => {
    const marks = gitMarks({ changes: CHANGES, truncated: true });
    expect(marks.files.get("pwa/src/features/workspace/model.ts")).toBe("modified");
    expect(marks.files.get("pwa/src/lib/workspace.ts")).toBe("modified");
    expect(marks.files.get("pwa/bun.lock")).toBe("conflict");
    expect(marks.files.get("README.md")).toBe("deleted");
    expect(marks.dirs.get("pwa")).toBe(5);
    expect(marks.dirs.get("pwa/src/features/workspace")).toBe(3);
    expect(marks.dirs.has("README.md")).toBe(false);
    expect(marks.truncated).toBe(true);
    expect(gitMarks(null).files.size).toBe(0);
  });

  test("the same status object reuses its marks", () => {
    const status = { changes: CHANGES, truncated: false };
    expect(gitMarks(status)).toBe(gitMarks(status));
  });
});

describe("breadcrumb folding", () => {
  const crumbs = (path: string) => ["", ...path.split("/")].map((_, i, all) => ({ path: all.slice(1, i + 1).join("/") }));

  test("three segments or fewer stay whole", () => {
    expect(foldBreadcrumbs(crumbs("pwa/src"))).toHaveLength(3);
  });

  test("deeper paths keep root, parent and current around one fold", () => {
    const shown = foldBreadcrumbs(crumbs("pwa/src/features/workspace"));
    expect(shown.map((crumb) => "fold" in crumb ? "…" : crumb.path)).toEqual(["", "…", "pwa/src/features", "pwa/src/features/workspace"]);
    expect(shown[1].path).toBe("pwa/src");
  });
});

describe("file name rules", () => {
  test("accepts ordinary names and rejects the reserved ones", () => {
    expect(fileNameProblem("notes.md")).toBeNull();
    expect(fileNameProblem("  ")).toBe("empty");
    expect(fileNameProblem("..")).toBe("reserved");
    expect(fileNameProblem(".GIT")).toBe("reserved");
    expect(fileNameProblem("a/b")).toBe("separator");
    expect(fileNameProblem("a\\b")).toBe("separator");
    expect(fileNameProblem("a\u0007")).toBe("separator");
    expect(fileNameProblem("é".repeat(128))).toBe("tooLong");
  });
});
