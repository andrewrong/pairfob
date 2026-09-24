import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { presentModal, type ModalController } from "../../../shared/ui/overlay/modal";
import { useDialogLifecycle } from "../../../shared/ui/overlay/dialog-lifecycle";
import { QUICK_LABEL_LIMIT, QUICK_TEXT_LIMIT, type QuickCommand } from "../../settings/quick-command-model";

export function defaultQuickCommands(): QuickCommand[] {
  return [
    { id: "review", label: t("quick.reviewLabel"), text: t("quick.reviewText"), pinned: false },
    { id: "test", label: t("quick.testLabel"), text: t("quick.testText"), pinned: false },
    { id: "summary", label: t("quick.summaryLabel"), text: t("quick.summaryText"), pinned: false },
  ];
}

export type QuickCommandEdit = { action: "save"; label: string; text: string } | { action: "delete" };

/** What one reorder step did: moved within a group, across the slash commands, refused, or nowhere to go. */
export type QuickCommandStep = "moved" | "pinned" | "unpinned" | "pins-full" | null;

/** Keyboard and screen-reader reordering; dragging on the pad is pointer-only. Applied and saved at once. */
export type QuickCommandReorder = {
  can(direction: -1 | 1): boolean;
  step(direction: -1 | 1): QuickCommandStep;
};

type EditorRequest = {
  reorder?: QuickCommandReorder;
  /** Absent for a new command. */
  command?: QuickCommand;
  /** The current compose draft, offered as the new command's content. */
  draft?: string;
};

/** A draft's first line, short enough to read on a pad button. */
export function draftLabel(draft: string): string {
  return (draft.trim().split("\n")[0] ?? "").trim().slice(0, 8);
}

const STEP_COPY = {
  moved: "pad.moved", pinned: "pad.movedFirst", unpinned: "pad.movedAfter", "pins-full": "pad.pinsFull",
} as const;

function ReorderRow({ reorder }: { reorder: QuickCommandReorder }) {
  const [result, setResult] = useState<QuickCommandStep>(null);
  const button = (direction: -1 | 1) => <button type="button" className="quick-sheet-step"
    aria-label={t(direction < 0 ? "pad.moveEarlierAria" : "pad.moveLaterAria")}
    disabled={!reorder.can(direction)} onClick={() => setResult(reorder.step(direction))}>
    {t(direction < 0 ? "pad.moveEarlier" : "pad.moveLater")}</button>;
  return <div className="quick-sheet-reorder">
    <span className="quick-sheet-field-head">{t("pad.position")}</span>
    <div className="quick-sheet-steps">{button(-1)}{button(1)}</div>
    <p className="quick-sheet-hint" role="status">{result ? t(STEP_COPY[result]) : ""}</p>
  </div>;
}

function QuickCommandSheet({ modal, command, draft = "", reorder }: EditorRequest & { modal: ModalController<QuickCommandEdit> }) {
  const [label, setLabel] = useState(command?.label ?? "");
  const [text, setText] = useState(command?.text ?? "");
  const [fromDraft, setFromDraft] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const labelField = useRef<HTMLInputElement>(null);
  const creating = !command;
  const complete = Boolean(label.trim() && text.trim());
  useDialogLifecycle({ dialog: modal.dialog, onDismiss: modal.dismiss, onClose: modal.finish, cancelGuardMs: 0,
    sheet: { form: modal.form, scroller: body },
    focus: () => { if (creating) labelField.current?.focus({ preventScroll: true }); } });
  const title = t(creating ? "pad.sheetNew" : "pad.sheetEdit");
  return <dialog ref={modal.dialog} className="modal sheet quick-command-sheet" aria-labelledby={modal.titleId} data-react-modal="">
    <form ref={modal.form} method="dialog" onSubmit={event => {
      event.preventDefault();
      if (complete) modal.close({ action: "save", label: label.trim(), text });
    }}>
      <div className="sheet-grab" aria-hidden="true"><span className="sheet-grab-bar" /></div>
      <div className="quick-sheet-bar">
        <button type="button" className="quick-sheet-text-btn" onClick={modal.dismiss}>{t("pad.sheetCancel")}</button>
        <h2 id={modal.titleId} className="modal-title">{title}</h2>
        <button type="submit" className="quick-sheet-text-btn is-primary" disabled={!complete}>
          {t(creating ? "pad.sheetAdd" : "pad.sheetDone")}</button>
      </div>
      <div ref={body} className="quick-sheet-body">
        {creating && draft.trim() && !fromDraft && <button type="button" className="quick-sheet-draft" onClick={() => {
          setText(draft.slice(0, QUICK_TEXT_LIMIT));
          if (!label.trim()) setLabel(draftLabel(draft));
          setFromDraft(true);
        }}><span><b>{t("pad.fromDraft")}</b><small>{draft.trim().split("\n")[0]}</small></span><Plus size={18} aria-hidden="true" /></button>}
        <label className="quick-sheet-field">
          <span className="quick-sheet-field-head">{t("pad.fieldLabel")}
            <span className="quick-sheet-count">{t("pad.count", { count: label.length, limit: QUICK_LABEL_LIMIT })}</span></span>
          <input ref={labelField} value={label} maxLength={QUICK_LABEL_LIMIT} placeholder={t("pad.fieldLabelPlaceholder")}
            enterKeyHint="next" onChange={event => setLabel(event.target.value)} />
        </label>
        <label className="quick-sheet-field">
          <span className="quick-sheet-field-head">{t("pad.fieldText")}
            <span className="quick-sheet-count">{t("pad.count", { count: text.length, limit: QUICK_TEXT_LIMIT })}</span></span>
          <textarea value={text} maxLength={QUICK_TEXT_LIMIT} rows={4} placeholder={t("pad.fieldTextPlaceholder")}
            onChange={event => setText(event.target.value)} />
        </label>
        <p className="quick-sheet-hint">{t("pad.sheetHint")}</p>
        {!creating && reorder && <ReorderRow reorder={reorder} />}
        {!creating && <button type="button" className="quick-sheet-delete"
          onClick={() => modal.close({ action: "delete" })}>{t("pad.sheetDelete")}</button>}
      </div>
    </form>
  </dialog>;
}

/**
 * The half-height editor for one command. It only reports what the reader
 * chose; the pad owns where the command goes and saves the list.
 */
export function editQuickCommand(request: EditorRequest): Promise<QuickCommandEdit | null> {
  return presentModal<QuickCommandEdit>(modal => <QuickCommandSheet modal={modal} {...request} />,
    { replaceKey: "quick-command" }).result;
}
