import { useCallback, useState } from "react";
import type { DiffNoteTarget } from "../../lib/diff-notes";
import { t } from "../../lib/i18n";
import { AppNotice, useAppNotice } from "../../app/notice";
import { Button } from "../../shared/ui/primitives";
import {
  bumpWorkspaceNotes,
  ensureBranches,
  loadGitDiff,
  loadWorkspaceFile,
  refreshWorkspace,
  showWorkspaceTab,
  useWorkspace,
  type WorkspaceSnapshot,
} from "../../features/workspace";
import { BranchSheet } from "../../features/workspace/branches";
import { ChangeList } from "../../features/workspace/changes";
import { DiffDetail } from "../../features/workspace/diff";
import { FileDetail } from "../../features/workspace/file-detail";
import { FileList } from "../../features/workspace/files";
import { WorkspaceHeader } from "../../features/workspace/header";
import { DiffNoteEditor } from "../../features/workspace/notes";
import { ChangePending, ListPending } from "../../features/workspace/pending";

function retryCurrent(snapshot: WorkspaceSnapshot): void {
  if (snapshot.view === "file" && snapshot.detailPath) void loadWorkspaceFile(snapshot.detailPath);
  else if (snapshot.view === "diff" && snapshot.detailPath) void loadGitDiff(snapshot.detailPath, snapshot.diffLayer);
  else void refreshWorkspace();
}

function navHasContent(snapshot: WorkspaceSnapshot): boolean {
  if (snapshot.tab === "files") return snapshot.entries.length > 0;
  return snapshot.status !== null;
}

function WorkspaceTabs({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const count = snapshot.status?.changes.length ?? 0;
  // Without Git status there is only one view, so no tab strip at all.
  if (!snapshot.descriptor?.features.git_status) return null;
  return <div className="workspace-tabs" role="tablist" aria-label={t("workspace.title")}>
    <Button
      className={`workspace-tab${snapshot.tab === "files" ? " on" : ""}`}
      role="tab"
      aria-selected={snapshot.tab === "files"}
      onClick={() => showWorkspaceTab("files")}
    >{t("workspace.files")}</Button>
    <Button
      className={`workspace-tab${snapshot.tab === "changes" ? " on" : ""}`}
      role="tab"
      aria-selected={snapshot.tab === "changes"}
      onClick={() => showWorkspaceTab("changes")}
    >
      {t("workspace.changes")}
      {count > 0 && <span className="workspace-count">{`${count}${snapshot.status?.truncated ? "+" : ""}`}</span>}
    </Button>
  </div>;
}

function WorkspaceFeedback({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  if (!snapshot.error) return null;
  return <div className="workspace-feedback workspace-error workspace-feedback-pane" role="alert">
    <p>{snapshot.error}</p>
    <Button className="btn btn-small" onClick={() => retryCurrent(snapshot)}>{t("ft.retry")}</Button>
  </div>;
}

/** A failed action over content that is still valid: say why above it, keep the list. */
function WorkspaceErrorBar({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  return <div className="workspace-feedback workspace-error workspace-feedback-bar" role="alert">
    <p>{snapshot.error}</p>
    <Button className="btn btn-small" onClick={() => retryCurrent(snapshot)}>{t("workspace.refresh")}</Button>
  </div>;
}

function WorkspaceNotice() {
  const notice = useAppNotice();
  if (!notice) return null;
  return <div className="workspace-app-notice"><AppNotice /></div>;
}

function EmptyDetail({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  return <section className="workspace-detail-empty">
    <strong>{snapshot.descriptor?.name || t("workspace.title")}</strong>
    <p>{snapshot.descriptor?.root || ""}</p>
  </section>;
}

export function WorkspaceScreen() {
  const snapshot = useWorkspace();
  const [noteTarget, setNoteTarget] = useState<DiffNoteTarget | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const closeNote = useCallback((changed: boolean) => {
    setNoteTarget(null);
    if (changed) bumpWorkspaceNotes();
  }, []);
  const openBranches = useCallback(async () => {
    const branches = await ensureBranches();
    if (branches) setBranchOpen(true);
  }, []);

  const pendingNav = snapshot.view === "browser" && snapshot.loading && snapshot.pendingReveal && !navHasContent(snapshot);

  return <>
    <div className={`workspace-shell${snapshot.view === "browser" ? "" : " detail"}`}>
      <WorkspaceHeader snapshot={snapshot} onBranches={() => void openBranches()} />
      <WorkspaceNotice />
      <div className="workspace-body">
        <aside className="workspace-nav">
          <WorkspaceTabs snapshot={snapshot} />
          {snapshot.view === "browser" && snapshot.error && navHasContent(snapshot) && <WorkspaceErrorBar snapshot={snapshot} />}
          {snapshot.view === "browser" && snapshot.error && !navHasContent(snapshot) ? <WorkspaceFeedback snapshot={snapshot} />
            : pendingNav ? (snapshot.tab === "files" ? <ListPending /> : <ChangePending />)
            : snapshot.tab === "files" ? <FileList snapshot={snapshot} />
            : <ChangeList snapshot={snapshot} />}
        </aside>
        <main className="workspace-main">
          {snapshot.view === "file" ? <FileDetail snapshot={snapshot} />
            : snapshot.view === "diff" ? <DiffDetail snapshot={snapshot} onEditNote={setNoteTarget} />
            : <EmptyDetail snapshot={snapshot} />}
        </main>
      </div>
    </div>
    {noteTarget && <DiffNoteEditor target={noteTarget} onClose={closeNote} />}
    {branchOpen && snapshot.branches && <BranchSheet branches={snapshot.branches} onClose={() => setBranchOpen(false)} />}
  </>;
}
