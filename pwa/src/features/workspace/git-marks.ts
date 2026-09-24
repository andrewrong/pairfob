/**
 * Git status projections the inspector draws everywhere a path is listed:
 * per-file marks, per-directory change counts, the change-list sections and
 * the review order the diff stepper walks. Pure functions over the status the
 * workspace already loaded, so no extra reads.
 */
import { gitChangeKind, gitLayers, type GitChange, type GitChangeKind, type GitLayer } from "../../lib/workspace";

type Change = Readonly<GitChange>;
type StatusLike = { readonly changes: ReadonlyArray<Change>; readonly truncated: boolean } | null | undefined;

export type ChangeSection = "conflict" | "staged" | "worktree";

/** One reviewable diff: a path in one layer. */
export type ChangeStep = { path: string; layer: GitLayer; kind: GitChangeKind; change: Change };

export type GitMarks = {
  /** The mark a file row shows: its worktree kind, else its staged kind. */
  files: ReadonlyMap<string, GitChangeKind>;
  /** Changed files below each directory path (every ancestor counts). */
  dirs: ReadonlyMap<string, number>;
  truncated: boolean;
};

const CONFLICT_PAIRS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** Unmerged entries, including both-added and both-deleted. */
export function isConflict(change: Change): boolean {
  return CONFLICT_PAIRS.has(`${change.index}${change.worktree}`);
}

/**
 * Change-list sections in display order. A conflict is listed once, in its own
 * section, never again under staged or worktree.
 */
export function changeSections(changes: ReadonlyArray<Change>): Record<ChangeSection, ChangeStep[]> {
  const sections: Record<ChangeSection, ChangeStep[]> = { conflict: [], staged: [], worktree: [] };
  for (const change of changes) {
    if (isConflict(change)) {
      sections.conflict.push({ path: change.path, layer: "worktree", kind: "conflict", change });
      continue;
    }
    for (const layer of gitLayers(change)) {
      sections[layer].push({ path: change.path, layer, kind: gitChangeKind(change, layer), change });
    }
  }
  return sections;
}

/** The order the diff stepper walks: conflicts, then staged, then worktree. */
export function reviewOrder(changes: ReadonlyArray<Change>): ChangeStep[] {
  const sections = changeSections(changes);
  return [...sections.conflict, ...sections.staged, ...sections.worktree];
}

/** Layers a path can be diffed in; a conflict only offers the worktree. */
export function layersFor(changes: ReadonlyArray<Change>, path: string): GitLayer[] {
  const change = changes.find((item) => item.path === path);
  if (!change) return [];
  return isConflict(change) ? ["worktree"] : gitLayers(change);
}

const cache = new WeakMap<object, GitMarks>();

export function gitMarks(status: StatusLike): GitMarks {
  if (!status) return { files: new Map(), dirs: new Map(), truncated: false };
  const cached = cache.get(status);
  if (cached) return cached;
  const files = new Map<string, GitChangeKind>();
  const dirs = new Map<string, number>();
  for (const change of status.changes) {
    const layers = gitLayers(change);
    const kind = isConflict(change) ? "conflict"
      : layers.includes("worktree") ? gitChangeKind(change, "worktree")
      : gitChangeKind(change, layers[0] ?? "worktree");
    files.set(change.path, kind);
    const parts = change.path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const dir = parts.slice(0, depth).join("/");
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
    }
  }
  const marks = { files, dirs, truncated: status.truncated };
  cache.set(status, marks);
  return marks;
}

/**
 * Breadcrumb segments that stay visible. Past three segments the middle folds
 * into one "…" entry: root, fold, parent, current.
 */
export function foldBreadcrumbs<T extends { path: string }>(crumbs: readonly T[]): Array<T | { fold: true; path: string }> {
  if (crumbs.length <= 3) return [...crumbs];
  return [crumbs[0], { fold: true, path: crumbs[crumbs.length - 3].path }, crumbs[crumbs.length - 2], crumbs[crumbs.length - 1]];
}

/** Rename rules shared by the live form check and the final submit guard. */
export function fileNameProblem(value: string): "empty" | "reserved" | "separator" | "tooLong" | null {
  if (!value.trim()) return "empty";
  if (value === "." || value === ".." || value.toLowerCase() === ".git") return "reserved";
  if (/[/\\\p{Cc}]/u.test(value)) return "separator";
  if (new TextEncoder().encode(value).length > 255) return "tooLong";
  return null;
}
