import { useId, useRef, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "../../lib/i18n";
import { PAIR_CODE_WITH_LOCATOR_PATTERN } from "../../lib/pairing-input";
import { useDialogLifecycle } from "../../shared/ui/overlay/dialog-lifecycle";
import { SheetContent } from "../../shared/ui/overlay/sheet-content";
import { Button } from "../../shared/ui/primitives";
import { formatPairCodeDraft, type ConnectViewModel } from "./model";

/**
 * The typed-code fallback as a bottom sheet (a centered modal on desk). Its
 * open state is the pairing domain's `pairManualOpen`, so a code error, a paste
 * or "enter the code instead" from the scanner all open the same sheet, and
 * dismissing it keeps the draft and its error for the next open. The field is
 * controlled by the pairing domain; the sheet lifts above the soft keyboard.
 */
export function PairCodeSheet({ view, onDismiss, onPaste, onSubmit, onCodeChange }: {
  view: ConnectViewModel;
  onDismiss: () => void;
  onPaste: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCodeChange: (code: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogLifecycle({ dialog, onDismiss, onClose: onDismiss, restoreFocus: true, cancelGuardMs: 0,
    sheet: { form, scroller: body },
    focus: () => form.current?.querySelector<HTMLInputElement>("#pair-code")?.focus({ preventScroll: true }) });
  const notice = view.sheetNotice;
  const error = notice?.tone === "error";
  const hint = notice?.text ?? t("connect.pairHelp");
  return createPortal(
    <dialog ref={dialog} className="modal sheet pair-code-sheet" aria-labelledby={titleId} data-react-modal="" data-state-portal="">
      <form ref={form} method="dialog" className="connect-form" noValidate onSubmit={onSubmit}>
        <SheetContent title={t("connect.manual")} titleId={titleId} onDismiss={onDismiss} bodyRef={body}>
          <div className="pair-field-head">
            <label className="field-label" htmlFor="pair-code">{t("connect.pairCode")}</label>
            <Button className="pair-paste" onClick={onPaste}>{t("connect.paste")}</Button>
          </div>
          <input id="pair-code" name="code" type="text" className="pair-code-input" autoComplete="one-time-code"
            spellCheck={false} autoCapitalize="characters" autoCorrect="off" inputMode="text" enterKeyHint="go"
            placeholder={t("connect.pairHint")} value={view.pairCodeDraft} maxLength={20} required
            pattern={PAIR_CODE_WITH_LOCATOR_PATTERN} title={t("connect.pairTitle")}
            aria-invalid={view.pairCodeInvalid ? "true" : undefined} aria-describedby="pair-feedback"
            onChange={event => {
              const field = event.currentTarget;
              const atEnd = field.selectionStart === field.value.length;
              onCodeChange(atEnd ? formatPairCodeDraft(field.value) : field.value);
            }} />
          <div className={`pair-help${error ? " is-error" : ""}`}>
            <span id="pair-feedback" role={error ? "alert" : undefined}>{hint}</span>
            <span className={`field-count${view.pairCodeComplete ? " ok" : ""}`}>{`${view.pairCodeLength}/14`}</span>
          </div>
          <Button type="submit" className="btn btn-primary btn-connect">{t("connect.submit")}</Button>
        </SheetContent>
      </form>
    </dialog>,
    document.body,
  );
}
