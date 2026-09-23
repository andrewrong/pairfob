import { SheetHandle } from "../../shared/ui/overlay/sheet-content";
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { t } from "../../lib/i18n";
import { OPERATION_INPUT_LIMITS } from "../../lib/operations";
import type { FormResult } from "./operation-form-model";
import { ModalFrame, presentModal, type ModalController } from "../../shared/ui/overlay/modal";
import { bindSheetDrag } from "../../shared/ui/overlay/sheet-drag";

type Validation = { message: string; field?: string; id: string } | null;
const ValidationContext = createContext<Validation>(null);

function useFieldValidation(name: string) {
  const validation = useContext(ValidationContext);
  return validation?.field === name ? { "aria-invalid": true as const, "aria-describedby": validation.id } : {};
}

export function OperationField({ label, name, value = "", placeholder = "", required = false }: {
  label: string; name: string; value?: string; placeholder?: string; required?: boolean;
}) {
  const invalid = useFieldValidation(name);
  const maxLength = name === "label" ? OPERATION_INPUT_LIMITS.label
    : name === "branch" ? OPERATION_INPUT_LIMITS.branch : name === "base" ? OPERATION_INPUT_LIMITS.base
      : name === "path" ? OPERATION_INPUT_LIMITS.path : OPERATION_INPUT_LIMITS.cwd;
  return <label className="operation-field">{label}<input type="text" name={name} defaultValue={value}
    placeholder={placeholder} required={required} maxLength={maxLength} autoComplete="off" spellCheck={false} {...invalid} /></label>;
}

export function OperationSelect({ label, name, choices, selected }: {
  label: string; name: string; choices: Array<{ value: string; label: string }>; selected?: string;
}) {
  const invalid = useFieldValidation(name);
  const value = choices.some(choice => choice.value === selected) ? selected : choices[0]?.value;
  return <label className="operation-field">{label}<select name={name} defaultValue={value} {...invalid}>
    {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
  </select></label>;
}

/**
 * One choice from a short list, as tiles instead of a dropdown: every option is
 * visible and one tap away. Native radios keep the form value and keyboard
 * behavior; the group carries the validation state.
 */
export function OperationChoice({ label, name, choices, selected }: {
  label: string; name: string; choices: Array<{ value: string; label: string; mark: string }>; selected?: string;
}) {
  const invalid = useFieldValidation(name);
  const value = choices.some(choice => choice.value === selected) ? selected : choices[0]?.value;
  return <fieldset className="operation-field operation-choice" role="radiogroup" data-field={name} aria-label={label} {...invalid}>
    <legend>{label}</legend>
    <div className="operation-tiles">
      {choices.map(choice => <label key={choice.value} className="operation-tile">
        <input type="radio" name={name} value={choice.value} defaultChecked={choice.value === value} />
        <span className="operation-tile-mark" aria-hidden="true">{choice.mark}</span>
        <span className="operation-tile-label">{choice.label}</span>
      </label>)}
    </div>
  </fieldset>;
}

export function OperationPrompt() {
  const invalid = useFieldValidation("text");
  return <label className="operation-field">{t("form.task")}<textarea name="text" required
    maxLength={OPERATION_INPUT_LIMITS.prompt} rows={7} {...invalid} /></label>;
}

export function OperationFrame<T>({ modal, title, children, onSubmit, onInput, focusDialog = false }: {
  modal: ModalController<T>; title: string; children: ReactNode; focusDialog?: boolean;
  onSubmit?: React.FormEventHandler<HTMLFormElement>; onInput?: React.FormEventHandler<HTMLFormElement>;
}) {
  useLayoutEffect(() => {
    return bindSheetDrag({ dialog: modal.dialog.current!, form: modal.form.current!, scroller: modal.dialog.current,
      close: modal.dismiss });
  }, [modal]);
  return <ModalFrame modal={modal} title={title} className="modal operation-modal" onSubmit={onSubmit} onInput={onInput}
    focus={form => focusDialog ? modal.dialog.current?.focus() : form.querySelector<HTMLElement>("input, select, textarea, button")?.focus()}
    heading={<><SheetHandle />
      <h2 id={modal.titleId} className="modal-title">{title}</h2></>}>
    {children}
  </ModalFrame>;
}

function FormDialog<T>({ modal, title, submitLabel, fields, read }: {
  modal: ModalController<T>; title: string; submitLabel: string; fields: ReactNode; read: (data: FormData) => FormResult<T>;
}) {
  const [validation, setValidation] = useState<Validation>(null);
  const validationId = `${modal.titleId}-validation`;
  useLayoutEffect(() => {
    if (!validation?.field) return;
    const form = modal.form.current;
    const target = form?.elements.namedItem(validation.field);
    if (target instanceof HTMLElement) target.focus();
    // A tile group names several radios: focus its chosen tile, else the first.
    else if (form) {
      const radios = [...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${validation.field}"]`)];
      (radios.find(radio => radio.checked) ?? radios[0])?.focus();
    }
  }, [modal, validation]);
  return <ValidationContext value={validation}>
    <OperationFrame modal={modal} title={title} onInput={() => setValidation(null)} onSubmit={event => {
      event.preventDefault();
      const result = read(new FormData(event.currentTarget));
      if (result.ok) modal.close(result.value);
      else setValidation({ message: result.message, field: result.field, id: validationId });
    }}>
      <div className="operation-body">
        {fields}
        <p id={validationId} className="notice notice-error" role="alert" hidden={!validation}>{validation?.message}</p>
        <div className="action-row">
          <button type="submit" className="btn btn-small btn-primary">{submitLabel}</button>
          <button type="button" className="btn btn-small btn-ghost" onClick={modal.dismiss}>{t("cancel")}</button>
        </div>
      </div>
    </OperationFrame>
  </ValidationContext>;
}

export function formDialog<T>(title: string, submitLabel: string, fields: ReactNode,
  read: (data: FormData) => FormResult<T>): Promise<T | null> {
  return presentModal<T>(modal => <FormDialog modal={modal} title={title} submitLabel={submitLabel} fields={fields} read={read} />).result;
}
