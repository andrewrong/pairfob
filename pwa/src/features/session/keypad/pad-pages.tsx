import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../../../lib/i18n";
import { PadChromeButton } from "../compose-focus";
import { clearModifiers } from "./keypad";
import { PAD_HOLD_EVENT } from "./key-press";

/** Fixed two-row pages. Keep this component mounted to remember each mode's page. */
export function PadPages({ items, kind, label, columns = 4, className = "", footer }: {
  items: ReactNode[]; kind: string; label: string; columns?: 4 | 7; className?: string; footer?: ReactNode;
}) {
  const [positions, setPositions] = useState<Record<string, number>>({});
  const pageSize = columns * 2;
  const count = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(positions[kind] ?? 0, count - 1);
  const ref = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const selectRef = useRef<(next: number) => void>(() => undefined);
  selectRef.current = (next) => {
    const target = Math.max(0, Math.min(count - 1, next));
    if (target === page) return;
    clearModifiers();
    setPositions((old) => ({ ...old, [kind]: target }));
  };
  useLayoutEffect(() => {
    const root = ref.current!;
    const doc = root.ownerDocument;
    let start: { id: number; x: number; y: number; holding: boolean } | null = null;
    const down = (event: PointerEvent) => {
      suppressClick.current = false;
      if (event.pointerType !== "touch" || !event.isPrimary) { start = null; return; }
      start = { id: event.pointerId, x: event.clientX, y: event.clientY, holding: false };
    };
    const move = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        suppressClick.current = true;
      }
    };
    const up = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      // Once a hold has sent keys, its release must not also navigate.
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.4 && !start.holding) {
        suppressClick.current = true;
        selectRef.current(page + (dx < 0 ? 1 : -1));
      }
      start = null;
    };
    const hold = (event: Event) => {
      if (start?.id === (event as CustomEvent<number>).detail) start.holding = true;
    };
    const cancel = () => { start = null; suppressClick.current = true; };
    const visibility = () => { if (doc.hidden) cancel(); };
    const click = (event: MouseEvent) => {
      if (suppressClick.current && (event.detail !== 0 || ("pointerType" in event && event.pointerType))) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    doc.defaultView?.addEventListener("blur", cancel);
    doc.addEventListener("visibilitychange", visibility);
    root.addEventListener(PAD_HOLD_EVENT, hold);
    root.addEventListener("pointerdown", down, true);
    root.addEventListener("click", click, true);
    doc.addEventListener("pointermove", move, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", cancel, true);
    return () => {
      doc.defaultView?.removeEventListener("blur", cancel);
      doc.removeEventListener("visibilitychange", visibility);
      root.removeEventListener(PAD_HOLD_EVENT, hold);
      root.removeEventListener("pointerdown", down, true);
      root.removeEventListener("click", click, true);
      doc.removeEventListener("pointermove", move, true);
      doc.removeEventListener("pointerup", up, true);
      doc.removeEventListener("pointercancel", cancel, true);
    };
  }, [page, kind]);
  return <div className="pad-pages">
    <div ref={ref} className={`pad-page ${className}`} data-columns={columns} role="group" aria-label={label}>
      {items.slice(page * pageSize, (page + 1) * pageSize)}
    </div>
    <div className="pad-pagination" role="group" aria-label={t("keys.pages")}>
      {Array.from({ length: count }, (_, index) => <PadChromeButton
        key={index} className="pad-page-dot" type="button"
        aria-label={t("keys.page", { page: index + 1, total: count })}
        aria-current={index === page ? "page" : undefined}
        onClick={() => selectRef.current(index)}
      ><span /></PadChromeButton>)}
      {footer}
    </div>
  </div>;
}
