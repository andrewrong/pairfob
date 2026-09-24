import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../../lib/i18n";
import { Button } from "../../shared/ui/primitives";
import { stepWorkspaceDiff, workspaceDiffStep } from "./actions";
import type { WorkspaceSnapshot } from "./model";

/**
 * Previous / next changed file, in the change list's order (conflicts, staged,
 * worktree). The ends disable rather than wrap.
 */
export function DiffStepper({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  if (!snapshot.status) return null;
  const step = workspaceDiffStep();
  if (step.total < 1) return null;
  const name = snapshot.detailPath.split("/").pop() || snapshot.detailPath;
  return <nav className="workspace-stepper" aria-label={t("workspace.changes")}>
    <Button className="workspace-step" aria-label={t("workspace.prevChangeLabel")} disabled={!step.prev || snapshot.loading}
      onClick={() => stepWorkspaceDiff(-1)}>
      <ChevronLeft size={18} aria-hidden="true" /><span>{t("workspace.prevChange")}</span>
    </Button>
    <div className="workspace-step-where" aria-live="polite">
      <strong>{name}</strong>
      {step.index >= 0 && <span>{t("workspace.stepPosition", { index: step.index + 1, total: step.total })}</span>}
    </div>
    <Button className="workspace-step" aria-label={t("workspace.nextChangeLabel")} disabled={!step.next || snapshot.loading}
      onClick={() => stepWorkspaceDiff(1)}>
      <span>{t("workspace.nextChange")}</span><ChevronRight size={18} aria-hidden="true" />
    </Button>
  </nav>;
}
