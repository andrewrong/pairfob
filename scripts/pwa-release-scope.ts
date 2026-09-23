/** Compare the actual working tree, including untracked files, to a verified release. */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const config = "workers/pairfob-origin/wrangler.jsonc";

function withoutBuild(text: string): string {
  // Only one literal BUILD string may differ; every other byte must match.
  const matches = [...text.matchAll(/"BUILD"\s*:\s*"[^"\r\n]*"/g)];
  if (matches.length !== 1) throw new Error("Expected exactly one BUILD in origin config");
  return text.replace(/("BUILD"\s*:\s*)"[^"\r\n]*"/, '$1"<build>"');
}

export function checkPwaScope(root: string, baseline: string): string[] {
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (!baseline || baseline.startsWith("-")) throw new Error("A previously verified commit is required");
  const commit = git("rev-parse", "--verify", `${baseline}^{commit}`).trim();
  const changed = new Set([
    ...git("diff", "--name-only", "--no-renames", "-z", commit, "--").split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean));
  const blocked: string[] = [];
  for (const path of changed) {
    if (path.startsWith("pwa/") && !path.startsWith("pwa/src/lib/protocol/")) {
      try {
        if (lstatSync(join(root, path)).isSymbolicLink()) blocked.push(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      continue;
    }
    if (path === config) {
      try {
        if (withoutBuild(git("show", `${commit}:${config}`)) === withoutBuild(readFileSync(join(root, path), "utf8"))) continue;
      } catch { /* missing or malformed config requires the full gate */ }
    }
    blocked.push(path);
  }
  if (blocked.length) throw new Error(`Full verify required; changes outside PWA UI scope:\n${blocked.join("\n")}`);
  return [...changed];
}

if (import.meta.main) {
  try {
    const changed = checkPwaScope(process.cwd(), process.argv[2] ?? "");
    console.log(`PWA-only scope verified against ${process.argv[2]} (${changed.length} changed paths).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
