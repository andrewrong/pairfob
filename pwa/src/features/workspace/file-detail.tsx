import { Ellipsis, WrapText } from "lucide-react";
import { Fragment, useMemo } from "react";
import { highlightSource, type SyntaxToken } from "../../lib/syntax-highlight";
import { t } from "../../lib/i18n";
import { Button } from "../../shared/ui/primitives";
import { loadWorkspaceFile, refreshWorkspace } from "./actions";
import { openDetailMenu } from "./detail-menu";
import { viewWorkspaceChanges } from "./file-actions";
import { FileIcon } from "./file-icon";
import { formatBytes, formatModified } from "./format";
import { GitMark } from "./git-mark";
import { gitMarks } from "./git-marks";
import { WorkspaceMedia } from "./media";
import type { WorkspaceSnapshot } from "./model";
import { FilePending, ReservedStat } from "./pending";
import { setWorkspaceWrap, useWorkspaceWrap } from "./prefs";

/**
 * Tokens regrouped per source line. Every line keeps its own "\n", so the
 * code element's text is exactly the file; numbers are CSS counters and never
 * enter a copy.
 */
function sourceLines(path: string, content: string): SyntaxToken[][] {
  const lines: SyntaxToken[][] = [[]];
  for (const token of highlightSource(path, content)) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      const text = index < parts.length - 1 ? `${part}\n` : part;
      if (text) lines[lines.length - 1].push({ ...token, text });
    });
  }
  if (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

/** Name and ⋯ repeat here on the desktop, where the header keeps the repository. */
export function DetailIdentity({ path }: { path: string }) {
  return <span className="workspace-detail-ident">
    <FileIcon kind="file" path={path} />
    <strong className="workspace-detail-name">{path}</strong>
  </span>;
}

export function DetailMoreButton() {
  return <Button className="icon-btn workspace-detail-more-inline" aria-label={t("workspace.moreActions")} aria-haspopup="dialog"
    onClick={() => openDetailMenu()}><Ellipsis size={18} aria-hidden="true" /></Button>;
}

export function FileDetail({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const file = snapshot.file;
  const wrap = useWorkspaceWrap();
  const reveal = Boolean(file && snapshot.revealFile);
  const path = file?.path || snapshot.detailPath;
  const text = file?.kind === "text" ? file : null;
  const lines = useMemo(() => text ? sourceLines(text.path, text.content) : [], [text]);
  const mark = gitMarks(snapshot.status).files.get(path);
  const viewChanges = mark ? viewWorkspaceChanges(path) : undefined;
  const retry = () => {
    if (snapshot.view === "file" && snapshot.detailPath) void loadWorkspaceFile(snapshot.detailPath);
    else void refreshWorkspace();
  };
  const meta = file
    ? [formatBytes(file.size), formatModified(file.modified_ms), text && `${t("workspace.lines", { count: lines.length })}${file.truncated ? "+" : ""}`]
      .filter(Boolean).join(" · ")
    : null;
  return <section className="workspace-detail-view" aria-label={t("workspace.file")}>
    <div className="workspace-detail-head">
      <DetailIdentity path={path} />
      {meta ? <span className="workspace-row-meta">{meta}</span>
        : snapshot.loading ? <ReservedStat className="workspace-row-meta" text={null} /> : null}
      <span className="workspace-detail-actions">
        {viewChanges && mark && <Button className="workspace-chip is-change" onClick={viewChanges}>
          <GitMark kind={mark} />{t("workspace.viewChanges")}
        </Button>}
        {text && <Button className="workspace-chip" aria-pressed={wrap} onClick={() => setWorkspaceWrap(!wrap)}>
          <WrapText size={14} aria-hidden="true" />{t("workspace.wrap")}
        </Button>}
        <DetailMoreButton />
      </span>
    </div>
    {snapshot.error ? (
      <div className="workspace-feedback workspace-error workspace-feedback-pane" role="alert">
        <p>{snapshot.error}</p>
        <Button className="btn btn-small" onClick={retry}>{t("ft.retry")}</Button>
      </div>
    ) : !file ? (
      snapshot.loading && snapshot.pendingReveal ? <FilePending /> : null
    ) : file.kind === "binary" ? (
      <WorkspaceMedia media={snapshot.media} />
    ) : (
      <>
        <pre className={`workspace-code${wrap ? " is-wrap" : ""}${reveal ? " workspace-reveal" : ""}`}>
          <code className="workspace-highlight">
            {lines.map((line, index) => <span key={index} className="workspace-code-line">
              {line.map((token, part) => <Fragment key={part}>
                {token.kind ? <span className={`syntax-${token.kind}`}>{token.text}</span> : token.text}
              </Fragment>)}
            </span>)}
          </code>
        </pre>
        {/* SVG text keeps its safe source and also offers a full-download
            entry through the owned media surface (SvgHint -> loadWorkspaceMedia
            fetches the whole file); never injected inline. */}
        {snapshot.media.role === "svg" ? <WorkspaceMedia media={snapshot.media} /> : null}
      </>
    )}
    {file?.truncated && <p className="workspace-limit">{t("workspace.previewTruncated")}</p>}
  </section>;
}
