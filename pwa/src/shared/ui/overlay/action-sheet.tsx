import { SegmentedOption } from "../primitives/segmented-control";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDialogLifecycle } from "./dialog-lifecycle";
import { SheetContent } from "./sheet-content";
import { presentModal, type ModalController } from "./modal";
import { SheetNavContext, type SheetNav, type SheetPage } from "./sheet-stack";

export type SheetAction = () => void | Promise<void>;
export type ActionSheetController = ModalController<SheetAction>;
export type ActionSheetOptions = {
  /** A second heading line naming what the sheet acts on. */
  subtitle?: string;
  /** Opens at a shorter height and grows on a pull or a tap on the handle. */
  expandable?: boolean;
  className?: string;
};

const PAGE_FOCUS = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)";

export function SheetFrame<T>({ modal, title, children, className = "", subtitle, expandable = false }: {
  modal: ModalController<T>; title: string; children: ReactNode; className?: string; subtitle?: string; expandable?: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<SheetPage[]>([]);
  const [motion, setMotion] = useState<"" | "push" | "pop">("");
  const [expanded, setExpanded] = useState(false);
  const depth = useRef(0);
  depth.current = pages.length;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const nav = useMemo<SheetNav>(() => ({
    push(page) { setMotion("push"); setPages(stack => [...stack, page]); },
    pop() { setMotion("pop"); setPages(stack => stack.slice(0, -1)); },
    depth: pages.length + 1,
  }), [pages.length]);
  useDialogLifecycle({ dialog: modal.dialog, onDismiss: modal.dismiss, onClose: modal.finish,
    onCancel: () => { if (depth.current) nav.pop(); else modal.dismiss(); },
    cancelGuardMs: 0, sheet: { form: modal.form, scroller: body },
    detents: expandable ? { expanded: () => expandedRef.current, set: setExpanded } : undefined,
    // A sheet may name its starting control with data-autofocus; otherwise the first enabled button.
    focus: () => (modal.form.current?.querySelector<HTMLElement>(".sheet-body [data-autofocus]:not(:disabled)")
      ?? modal.form.current?.querySelector<HTMLButtonElement>(".sheet-body button:not(:disabled)"))?.focus() });
  // A new page starts at its top and takes focus, so keyboard and screen-reader
  // users land in the page they asked for rather than on a removed control.
  useLayoutEffect(() => {
    if (!motion || !body.current) return;
    body.current.scrollTop = 0;
    body.current.querySelector<HTMLElement>(`.sheet-page ${PAGE_FOCUS}`)?.focus({ preventScroll: true });
  }, [pages.length, motion]);
  const top = pages.at(-1);
  // The root keeps its plain DOM until the reader first navigates, so sheets
  // that never push are laid out exactly as before.
  const page = top || motion
    ? <div key={top ? `${pages.length}:${top.key}` : "root"} className={`sheet-page is-${motion}`}>{top ? top.render() : children}</div>
    : children;
  const classes = ["modal", "sheet", expandable && "is-expandable", expanded && "is-expanded", className].filter(Boolean).join(" ");
  return <dialog ref={modal.dialog} className={classes} aria-labelledby={modal.titleId} data-react-modal="" data-react-action-sheet="">
    <form ref={modal.form} method="dialog" onSubmit={event => event.preventDefault()}>
      <SheetNavContext value={nav}>
        <SheetContent title={top?.title ?? title} subtitle={top ? undefined : subtitle} titleId={modal.titleId}
          onDismiss={modal.dismiss} onBack={top ? nav.pop : undefined} bodyRef={body}
          expand={expandable ? { expanded, toggle: () => setExpanded(value => !value) } : undefined}>
          {page}
        </SheetContent>
      </SheetNavContext>
    </form>
  </dialog>;
}

/** Follow-up dialogs open on the next task, after native close and React teardown. */
export function showActionSheet(title: string, content: (modal: ActionSheetController) => ReactNode,
  options: ActionSheetOptions = {}): void {
  for (const stale of document.querySelectorAll<HTMLDialogElement>("dialog.sheet[open]:not([data-react-action-sheet])")) stale.close();
  const modal = presentModal<SheetAction>(controller => <SheetFrame modal={controller} title={title} subtitle={options.subtitle}
    expandable={options.expandable} className={options.className}>
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

/**
 * A segmented choice. By default picking closes the sheet and runs the action
 * afterwards (the choice changes the screen). `stay` applies it in place for
 * adjustments the reader watches take effect behind the sheet.
 */
export function MenuRadio({ modal, label, aria, selected, action, disabled = false, stay = false }: {
  modal: ActionSheetController; label: string; aria: string; selected: boolean; action: SheetAction; disabled?: boolean; stay?: boolean;
}) {
  return <SegmentedOption selected={selected} aria-label={aria} disabled={disabled} onClick={() => {
    if (selected) return;
    if (stay) void action();
    else modal.close(action);
  }}>{label}</SegmentedOption>;
}
