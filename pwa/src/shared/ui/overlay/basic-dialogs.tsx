import { TriangleAlert, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { Button } from "../primitives/button";
import { ModalFrame, presentModal, type ModalController } from "./modal";

/**
 * A single-field editor. Cancel and Save sit in the heading, above the field,
 * so an on-screen keyboard never covers them. Save stays disabled until the
 * value changes. Enter commits the same way: an unchanged value dismisses with
 * `null` and a blank required value stays open. A disabled default button would
 * otherwise swallow the browser's implicit submission.
 */
export type TextRequest = {
  title: string;
  initial?: string;
  maxLength?: number;
  /** The field's name; defaults to a generic "Name". */
  label?: string;
  /** Guidance under the field, e.g. what an empty value means. */
  hint?: string;
  /** Replaces `hint` while the field is empty. */
  emptyHint?: string;
  /** When false, Save stays disabled for a blank value. */
  allowEmpty?: boolean;
  /** Live check; a message marks the field invalid, replaces the hint and blocks Save. */
  validate?: (value: string) => string | null;
};

function TextDialog({ modal, request }: { modal: ModalController<string>; request: TextRequest }) {
  const { title, initial = "", maxLength, label, hint, emptyHint, allowEmpty = true, validate } = request;
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const blank = !value.trim();
  const problem = value === initial ? null : validate?.(value) ?? null;
  const canSave = value !== initial && (allowEmpty || !blank) && !problem;
  const guidance = problem ?? (!value && emptyHint ? emptyHint : !allowEmpty && blank ? t("text.nameRequired") : hint);
  const commit = (next: string) => {
    if (next === initial) modal.dismiss();
    else if (validate?.(next)) return;
    else if (allowEmpty || next.trim()) modal.close(next);
  };
  return <ModalFrame modal={modal} title={title} className="modal text-edit" describedBy={guidance ? hintId : undefined}
    focus={form => { const field = form.querySelector("input")!; field.focus(); field.select(); }}
    heading={<div className="text-edit-head">
      <Button className="text-edit-action" onClick={modal.dismiss}>{t("cancel")}</Button>
      <h2 id={modal.titleId} className="modal-title">{title}</h2>
      <button type="submit" className="text-edit-action text-edit-save" disabled={!canSave}>{t("text.save")}</button>
    </div>}
    onSubmit={event => {
      event.preventDefault();
      commit((event.currentTarget.elements.namedItem("value") as HTMLInputElement).value);
    }}>
    <label className="text-edit-label" htmlFor={fieldId}>{label ?? t("op.fieldName")}</label>
    <div className={`text-edit-field${problem ? " is-invalid" : ""}`}>
      <input ref={input} id={fieldId} name="value" type="text" autoComplete="off" spellCheck={false} enterKeyHint="done"
        defaultValue={initial} maxLength={maxLength} aria-invalid={problem ? true : undefined} onInput={event => setValue(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }} />
      {value && <Button className="text-edit-clear" aria-label={t("text.clear")} onClick={() => {
        if (!input.current) return;
        input.current.value = "";
        setValue("");
        input.current.focus();
      }}><X size={14} aria-hidden="true" /></Button>}
    </div>
    {guidance && <p id={hintId} className={`text-edit-hint${problem ? " is-invalid" : ""}`} role={problem ? "alert" : undefined}>{guidance}</p>}
  </ModalFrame>;
}

export function askText(request: TextRequest): Promise<string | null> {
  return presentModal<string>(modal => <TextDialog modal={modal} request={request} />, {
    readClose: dialog => dialog.returnValue === "cancel" ? null : dialog.querySelector("input")!.value,
  }).result;
}

export type HelpBlock = string | { before: string; code: string; after: string };

export function showHelp(title: string, blocks: HelpBlock[]): void {
  presentModal<never>(modal => {
    const ids = blocks.map((_, i) => `${modal.titleId}-copy-${i}`);
    return <ModalFrame modal={modal} title={title} className="modal help" describedBy={ids.join(" ") || undefined}
      focus={form => form.querySelector<HTMLButtonElement>(".help-close")!.focus()}
      heading={<div className="help-head"><h2 id={modal.titleId} className="modal-title">{title}</h2>
        <button type="button" className="icon-btn help-close" aria-label={t("close")} onClick={modal.dismiss}><X size={20} aria-hidden="true" /></button>
      </div>}>
      {blocks.map((block, i) => <p key={i} id={ids[i]} className="help-copy">
        {typeof block === "string" ? block : <>{block.before}<code>{block.code}</code>{block.after}</>}
      </p>)}
    </ModalFrame>;
  }, { replaceKey: "help" });
}

/**
 * A confirmation that names its action and its object. The title is the
 * question itself; `subject` shows what is affected and its state; `warning`
 * calls out a consequence the reader might not expect (e.g. running work).
 */
export type ConfirmRequest = {
  title: string;
  message?: string;
  subject?: { name: string; detail?: string; status?: string };
  warning?: string;
  confirmLabel: string;
  /** Destructive by default; a reversible confirmation uses the primary tone. */
  tone?: "danger" | "primary";
};

export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  const { title, message, subject, warning, confirmLabel, tone = "danger" } = request;
  return presentModal<boolean>(modal => {
    const copyId = `${modal.titleId}-copy`;
    return <ModalFrame modal={modal} title={title} className="modal confirm" describedBy={message || warning ? copyId : undefined}
      focus={form => form.querySelector<HTMLButtonElement>(".confirm-cancel")!.focus()}>
      {subject && <div className="confirm-subject">
        <strong className="confirm-name">{subject.name}</strong>
        {subject.detail && <code className="confirm-detail">{subject.detail}</code>}
        {subject.status && <span className={`confirm-status${warning ? " is-busy" : ""}`}>{subject.status}</span>}
      </div>}
      <div id={copyId}>
        {message && <p className="lede confirm-copy">{message}</p>}
        {warning && <p className="confirm-warning"><TriangleAlert size={16} aria-hidden="true" /><span>{warning}</span></p>}
      </div>
      <div className="action-row confirm-actions">
        <button type="button" className="btn btn-small btn-ghost confirm-cancel" autoFocus onClick={modal.dismiss}>{t("cancel")}</button>
        <button type="button" className={`btn btn-small ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
          onClick={() => modal.close(true)}>{confirmLabel}</button>
      </div>
    </ModalFrame>;
  }, { cancelValue: false, readClose: dialog => dialog.returnValue === "confirm" }).result;
}
