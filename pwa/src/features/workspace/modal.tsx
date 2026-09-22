import { useRef, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogLifecycle } from "../../shared/ui/overlay/dialog-lifecycle";
import { SheetContent } from "../../shared/ui/overlay/sheet-content";
import { Button } from "../../shared/ui/primitives";

type WorkspaceDialogProps = {
  className: string;
  titleId: string;
  title?: string;
  sheet?: boolean;
  onDismiss: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  initialFocus?: () => HTMLElement | null;
};

/** Native `<dialog>` for workspace note editor and branch sheet. */
export function WorkspaceDialog({
  className, titleId, title, sheet = false, onDismiss, onSubmit, children, initialFocus,
}: WorkspaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useDialogLifecycle({ dialog: dialogRef, onDismiss, onClose: onDismiss, restoreFocus: true,
    sheet: sheet ? { form: formRef, scroller: bodyRef } : undefined,
    focus: () => {
      const target = initialFocus?.() ?? formRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled):not(.sheet-close)");
      target?.focus();
    } });

  return createPortal(
    <dialog
      ref={dialogRef}
      className={className}
      data-react-modal=""
      aria-labelledby={titleId}
    >
      <form
        ref={formRef}
        method="dialog"
        onSubmit={(event) => {
          if (onSubmit) onSubmit(event);
          else event.preventDefault();
        }}
      >
        {sheet ? <SheetContent title={title ?? ""} titleId={titleId} onDismiss={onDismiss} bodyRef={bodyRef}>
          {children}
        </SheetContent> : children}
      </form>
    </dialog>,
    document.body,
  );
}

export function SheetItem({ label, onPick, variant = "", disabled = false }: {
  label: string; onPick: () => void | Promise<void>; variant?: "" | "danger"; disabled?: boolean;
}) {
  return <Button className={`menu-item${variant ? ` menu-${variant}` : ""}`} disabled={disabled} onClick={() => {
    window.setTimeout(() => void onPick(), 0);
  }}>{label}</Button>;
}
