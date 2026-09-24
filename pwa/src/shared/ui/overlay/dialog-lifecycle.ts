import { useLayoutEffect, useRef, type RefObject } from "react";
import { bindSheetDrag } from "./sheet-drag";

type ElementRef<T> = RefObject<T | null>;
type DialogLifecycle = {
  dialog: ElementRef<HTMLDialogElement>;
  onDismiss: () => void;
  onClose: () => void;
  /** Escape; defaults to dismiss. A stacked sheet steps back a page instead. */
  onCancel?: () => void;
  focus?: () => void;
  restoreFocus?: boolean;
  cancelGuardMs?: number;
  /** False keeps the dialog open on a backdrop tap (editors with a draft). */
  backdropDismiss?: boolean;
  sheet?: { form: ElementRef<HTMLFormElement>; scroller: ElementRef<HTMLElement> };
  /** Two sheet heights; read through the latest callbacks so the binding stays put. */
  detents?: { expanded(): boolean; set(expanded: boolean): void };
};

/** Native dialog ownership shared by promise dialogs and state-controlled portals. */
export function useDialogLifecycle({ dialog, sheet, restoreFocus = false, cancelGuardMs = 400, backdropDismiss = true, ...callbacks }: DialogLifecycle) {
  const expandable = !!callbacks.detents;
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const form = sheet?.form;
  const scroller = sheet?.scroller;
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openedAt = performance.now();
    const dismiss = () => latest.current.onDismiss();
    const cancel = (event: Event) => {
      event.preventDefault();
      if (performance.now() - openedAt >= cancelGuardMs) (latest.current.onCancel ?? dismiss)();
    };
    const backdrop = (event: MouseEvent) => {
      if (backdropDismiss && event.target === element && performance.now() - openedAt >= 400) dismiss();
    };
    const closed = () => latest.current.onClose();
    element.addEventListener("cancel", cancel);
    element.addEventListener("click", backdrop);
    element.addEventListener("close", closed);
    element.showModal();
    const disposeDrag = form?.current ? bindSheetDrag({
      dialog: element, form: form.current, scroller: scroller?.current ?? null, close: dismiss,
      detents: expandable ? {
        expanded: () => latest.current.detents?.expanded() ?? false,
        set: (next) => latest.current.detents?.set(next),
      } : undefined,
    }) : undefined;
    latest.current.focus?.();
    return () => {
      disposeDrag?.();
      element.removeEventListener("cancel", cancel);
      element.removeEventListener("click", backdrop);
      element.removeEventListener("close", closed);
      if (element.open) element.close();
      if (restoreFocus) queueMicrotask(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, [dialog, form, scroller, restoreFocus, cancelGuardMs, expandable, backdropDismiss]);
}
