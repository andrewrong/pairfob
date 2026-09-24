import { CircleCheck, PenLine, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { canPromptAgent } from "../../lib/dashboard";
import {
  DIFF_NOTE_BODY_LIMIT,
  diffNoteCounts,
  diffNoteForPin,
  diffNoteScope,
  diffNoteSendOpen,
  diffNoteSending,
  diffNotesFor,
  removeDiffNote,
  upsertDiffNote,
  type DiffNotePin,
  type DiffNoteScope,
  type DiffNoteTarget,
} from "../../lib/diff-notes";
import { t } from "../../lib/i18n";
import type { GitLayer } from "../../lib/workspace";
import { showStatus } from "../../app/notices-store";
import { sendDiffNotesToAgent } from "../../features/operations/controller";
import { operationBusy } from "../operations/capabilities-store";
import { useCapabilities } from "../operations/hooks";
import { liveSession } from "../computers/catalog-store";
import { useDashboard } from "../dashboard/hooks";
import { useSession } from "../session/hooks";
import { agentFromDashboardSnapshot } from "../session/agents";
import { Button } from "../../shared/ui/primitives";
import { leaveWorkspace } from "./actions";
import { WorkspaceDialog } from "./modal";
import { bumpWorkspaceNotes } from "./store";

let editorSerial = 0;
/** The pin just saved; its card announces itself once, then this clears. */
let freshPin = "";

const pinKey = (pin: DiffNotePin) => `${pin.layer}:${pin.side}:${pin.line}:${pin.path}`;

export function diffLineHasNote(target: DiffNoteTarget): boolean {
  return diffNoteForPin(target) !== undefined;
}

export function diffNoteLineLabel(target: Pick<DiffNoteTarget, "line" | "side">): string {
  const side = target.side === "old" ? t("diffNotes.sideOld") : t("diffNotes.sideNew");
  return t("diffNotes.promptLine", { line: target.line, side });
}

function editorTitle(target: DiffNoteTarget, editing: boolean): string {
  return t(editing ? "diffNotes.editTitle" : "diffNotes.addTitle", { line: target.line });
}

function sameNoteOwner(left: DiffNoteScope | null, right: DiffNoteScope | null): boolean {
  return Boolean(left && right && left.session === right.session && left.paneId === right.paneId && left.revision === right.revision);
}

/**
 * A text-edit sheet: Cancel and Save sit above the field so the keyboard never
 * covers them, and the quoted line stands in for the row the keyboard hides.
 * The backdrop does not dismiss it, so a stray tap never drops a draft.
 */
export function DiffNoteEditor({ target, onClose }: { target: DiffNoteTarget; onClose: (changed: boolean) => void }) {
  const [owner] = useState(() => diffNoteScope());
  const existing = sameNoteOwner(owner, diffNoteScope()) ? diffNoteForPin(target) : undefined;
  const [titleId] = useState(() => `diff-note-title-${++editorSerial}`);
  const [validationId] = useState(() => `diff-note-validation-${editorSerial}`);
  const [invalid, setInvalid] = useState(false);
  const [draft, setDraft] = useState(existing?.body ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    for (const stale of document.querySelectorAll("dialog.diff-note-modal")) {
      if (stale !== textareaRef.current?.closest("dialog")) stale.remove();
    }
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!textarea.value.trim()) {
      setInvalid(true);
      textarea.focus();
      return;
    }
    if (!sameNoteOwner(owner, diffNoteScope())) {
      onClose(false);
      return;
    }
    if (!upsertDiffNote(target, textarea.value, owner)) {
      onClose(false);
      return;
    }
    freshPin = pinKey(target);
    const count = diffNotesFor(target.path, target.layer).length;
    showStatus(existing ? t("diffNotes.updated") : t("diffNotes.added", { count }));
    onClose(true);
  };
  const unchanged = draft.trim() === (existing?.body ?? "").trim();

  return <WorkspaceDialog
    className="modal text-edit diff-note-modal"
    titleId={titleId}
    onDismiss={() => onClose(false)}
    onSubmit={submit}
    initialFocus={() => textareaRef.current}
    keepOnBackdrop
  >
    <div className="text-edit-head">
      <Button className="text-edit-action" onClick={() => onClose(false)}>{t("cancel")}</Button>
      <h2 className="modal-title" id={titleId} aria-label={editorTitle(target, Boolean(existing))}>{t("diffNotes.lineTitle", { line: target.line })}</h2>
      <button type="submit" className="text-edit-action text-edit-save" disabled={unchanged}>{t("text.save")}</button>
    </div>
    <p className={`diff-note-quote side-${target.side}`}>
      <span className="diff-note-quote-line">{diffNoteLineLabel(target)}</span>
      {target.snippet ? <code className="diff-note-quote-text">{target.snippet}</code> : null}
    </p>
    <label className="text-edit-label" htmlFor={`${titleId}-body`}>{t("diffNotes.field")}</label>
    <textarea
      ref={textareaRef}
      id={`${titleId}-body`}
      className="diff-note-body-field"
      name="body"
      rows={4}
      maxLength={DIFF_NOTE_BODY_LIMIT}
      placeholder={t("diffNotes.placeholder")}
      defaultValue={existing?.body ?? ""}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? validationId : undefined}
      onInput={(event) => { setInvalid(false); setDraft(event.currentTarget.value); }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }}
    />
    <p className="notice notice-error" id={validationId} role="alert" hidden={!invalid}>
      {invalid ? t("diffNotes.needBody") : ""}
    </p>
    <div className="diff-note-foot">
      <span className="diff-note-count">{`${draft.length} / ${DIFF_NOTE_BODY_LIMIT}`}</span>
      {existing && <Button className="diff-note-remove" onClick={() => {
        if (!sameNoteOwner(owner, diffNoteScope())) {
          onClose(false);
          return;
        }
        removeDiffNote(existing.id);
        showStatus(t("diffNotes.removed"));
        onClose(true);
      }}>{t("diffNotes.deleteNote")}</Button>}
    </div>
  </WorkspaceDialog>;
}

export function DiffNoteCards({ target, onEdit }: { target: DiffNoteTarget; onEdit: (target: DiffNoteTarget) => void }) {
  const note = diffNoteForPin(target);
  const card = useRef<HTMLDivElement>(null);
  const fresh = Boolean(note) && freshPin === pinKey(target);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!fresh) return;
    freshPin = "";
    setFlash(true);
    const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [fresh]);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(false), 1200);
    return () => window.clearTimeout(timer);
  }, [flash]);
  if (!note) return null;
  const sending = diffNoteSending(note.id) || diffNoteSendOpen();
  return <div ref={card} className={`workspace-diff-note${fresh || flash ? " is-fresh" : ""}${sending ? " is-sending" : ""}`}>
    <div className="diff-note-main" onClick={() => { if (!sending) onEdit(target); }}>
      <PenLine className="diff-note-mark" size={16} aria-hidden="true" />
      <span className="diff-note-body">{note.body}</span>
    </div>
    <div className="diff-note-actions">
      <Button className="btn btn-small btn-ghost diff-note-action" aria-label={editorTitle(target, true)} disabled={sending} onClick={() => onEdit(target)}>
        {t("diffNotes.edit")}
      </Button>
      <Button className="btn btn-small btn-ghost diff-note-action" aria-label={t("diffNotes.remove")} disabled={sending} onClick={() => {
        removeDiffNote(note.id);
        bumpWorkspaceNotes();
        showStatus(t("diffNotes.removed"));
      }}>{t("diffNotes.remove")}</Button>
    </div>
  </div>;
}

/**
 * Pending comments for this file and layer, then — once sent — a receipt with
 * the way back to the terminal where the agent's work shows up. The parent
 * keys this bar by file and layer, so a receipt never follows the reader to
 * another diff.
 */
export function DiffNotesBar({ path, layer, paneId }: { path: string; layer: GitLayer; paneId: string }) {
  // Subscribed snapshots: the bar re-renders with capability, busy and pane
  // changes instead of reading one-shot published copies during render.
  const capabilities = useCapabilities();
  const dashboard = useDashboard();
  const session = useSession();
  const [receipt, setReceipt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const count = diffNotesFor(path, layer).length;
  if (!capabilities.operationCapabilities.prompt_agent) return null;
  if (!count && receipt) {
    return <div className="workspace-notes-bar is-sent" role="status">
      <CircleCheck className="workspace-notes-ok" size={22} aria-hidden="true" />
      <span className="workspace-notes-copy">
        <strong>{t("diffNotes.sentReceipt", { count: receipt })}</strong>
        <small>{t("diffNotes.sentDetail")}</small>
      </span>
      <Button className="workspace-chip workspace-notes-terminal" onClick={leaveWorkspace}>{t("workspace.backToTerminal")}</Button>
      <Button className="icon-btn workspace-notes-dismiss" aria-label={t("diffNotes.dismissReceipt")} onClick={() => setReceipt(0)}>
        <X size={18} aria-hidden="true" />
      </Button>
    </div>;
  }
  if (!count) return null;
  const sending = capabilities.operationBusy || diffNoteSendOpen();
  const canSend = canPromptAgent(agentFromDashboardSnapshot(dashboard, session.paneId));
  const counts = diffNoteCounts(liveSession(), paneId);
  counts.delete(`${layer}:${path}`);
  const others = counts.size;
  const layerName = layer === "staged" ? t("workspace.staged") : t("workspace.worktree");
  const detail = !canSend ? t("diffNotes.noAgent")
    : others ? t("diffNotes.otherFiles", { count: others })
    : t("diffNotes.thisFile", { layer: layerName });
  const send = async () => {
    const before = diffNotesFor(path, layer).length;
    await sendDiffNotesToAgent(path, layer);
    if (mounted.current && before && !diffNotesFor(path, layer).length) setReceipt(before);
  };
  return <div className="workspace-notes-bar">
    <span className="workspace-notes-copy">
      <strong className="workspace-notes-count">{t("diffNotes.pending", { count })}</strong>
      <small className={canSend ? "" : "workspace-notes-hint"}>{detail}</small>
    </span>
    <Button
      className="btn btn-primary workspace-notes-send"
      disabled={!canSend || sending}
      aria-busy={sending || undefined}
      onClick={() => void send()}
    >{sending ? <><span className="spinner" aria-hidden="true" />{t("diffNotes.sending")}</> : t("diffNotes.send")}</Button>
  </div>;
}

export function openNoteEditorAllowed(target: DiffNoteTarget): boolean {
  const existing = diffNoteForPin(target);
  if (existing && diffNoteSending(existing.id)) return false;
  if (operationBusy()) return false;
  return true;
}
