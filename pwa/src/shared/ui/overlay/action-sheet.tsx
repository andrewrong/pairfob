import { SegmentedOption } from "../primitives/segmented-control";
import { useRef, type ReactNode } from "react";
import { useDialogLifecycle } from "./dialog-lifecycle";
import { SheetContent } from "./sheet-content";
import { presentModal, type ModalController } from "./modal";

export type SheetAction = () => void | Promise<void>;
export type ActionSheetController = ModalController<SheetAction>;

export function SheetFrame<T>({ modal, title, children, className = "" }: {
  modal: ModalController<T>; title: string; children: ReactNode; className?: string;
}) {
  const body = useRef<HTMLDivElement>(null);
  useDialogLifecycle({ dialog: modal.dialog, onDismiss: modal.dismiss, onClose: modal.finish,
    cancelGuardMs: 0, sheet: { form: modal.form, scroller: body },
    focus: () => modal.form.current?.querySelector<HTMLButtonElement>("button:not(:disabled):not(.sheet-close)")?.focus() });
  return <dialog ref={modal.dialog} className={`modal sheet${className ? ` ${className}` : ""}`} aria-labelledby={modal.titleId} data-react-modal="" data-react-action-sheet="">
    <form ref={modal.form} method="dialog" onSubmit={event => event.preventDefault()}>
      <SheetContent title={title} titleId={modal.titleId} onDismiss={modal.dismiss} bodyRef={body}>
        {children}
      </SheetContent>
    </form>
  </dialog>;
}

/** Follow-up dialogs open on the next task, after native close and React teardown. */
export function showActionSheet(title: string, content: (modal: ActionSheetController) => ReactNode): void {
  for (const stale of document.querySelectorAll<HTMLDialogElement>("dialog.sheet[open]:not([data-react-action-sheet])")) stale.close();
  const modal = presentModal<SheetAction>(controller => <SheetFrame modal={controller} title={title}>
    {content(controller)}
  </SheetFrame>, { replaceKey: "action-sheet" });
  void modal.result.then(action => { if (action) window.setTimeout(() => void action(), 0); });
}

export function MenuItem({ modal, children, action, danger = false, disabled = false }: {
  modal: ActionSheetController; children: ReactNode; action?: SheetAction; danger?: boolean; disabled?: boolean;
}) {
  return <button type="button" className={`menu-item${danger ? " menu-danger" : ""}`} disabled={disabled}
    onClick={() => action ? modal.close(action) : modal.dismiss()}>{children}</button>;
}

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return <><h3 className="menu-section-title">{title}</h3>{children}</>;
}

export function MenuRadio({ modal, label, aria, selected, action, disabled = false }: {
  modal: ActionSheetController; label: string; aria: string; selected: boolean; action: SheetAction; disabled?: boolean;
}) {
  return <SegmentedOption selected={selected} aria-label={aria} disabled={disabled} onClick={() => { if (!selected) modal.close(action); }}>{label}</SegmentedOption>;
}
