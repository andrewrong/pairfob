import { t } from "../../lib/i18n";
import type { GitChangeKind } from "../../lib/workspace";
import { CHANGE_CODES, changeKindLabel } from "./format";

/** A change code whose glyph alone tells the kinds apart; the label is spoken. */
export function GitMark({ kind }: { kind: GitChangeKind }) {
  const label = changeKindLabel(kind);
  return <span className={`workspace-git-mark mark-${kind}`} title={label} role="img" aria-label={label}>
    {CHANGE_CODES[kind]}
  </span>;
}

/** Changed files somewhere below a directory; `+` when the status was truncated. */
export function DirMark({ count, truncated }: { count: number; truncated: boolean }) {
  const label = t("workspace.dirChanges", { count });
  return <span className="workspace-dir-mark" title={label} role="img" aria-label={label}>
    <i aria-hidden="true" />{`${count}${truncated ? "+" : ""}`}
  </span>;
}
