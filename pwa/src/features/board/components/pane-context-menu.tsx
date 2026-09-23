import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowRight, Maximize, Pencil, Plus, Trash2 } from "lucide-react";
import { t } from "../../../lib/i18n";
import type { TabLayoutView } from "../../../lib/layout";
import type { ModalController } from "../../../shared/ui/overlay/modal";
import { useDialogLifecycle } from "../../../shared/ui/overlay/dialog-lifecycle";
import { layoutActionReason, layoutButtons, type BoardLayoutAction, type BoardPaneAction, type PaneMenuModel } from "../model/pane-menu";

export type PaneMenuAnchor = { x: number; y: number };
const icons = { open: ArrowRight, right: Plus, down: ArrowDown, zoom: Maximize, rename: Pencil, close: Trash2 };

/** The tab's real split, this pane highlighted: what "left", "wider" and "swap" refer to. */
function PaneMinimap({ layout, paneId }: { layout: TabLayoutView | null; paneId: string }) {
  if (!layout || layout.area.width <= 0 || layout.area.height <= 0 || layout.panes.length < 2) return null;
  const { area } = layout;
  const pct = (value: number) => `${(value * 100).toFixed(3)}%`;
  return <div className="board-menu-map" aria-hidden="true">
    {layout.panes.map(pane => <span key={pane.paneId} className={pane.paneId === paneId ? "on" : undefined} style={{
      left: pct((pane.rect.x - area.x) / area.width), top: pct((pane.rect.y - area.y) / area.height),
      width: pct(pane.rect.width / area.width), height: pct(pane.rect.height / area.height),
    }} />)}
  </div>;
}

/**
 * A pane's actions on the board, as a bottom sheet. The layout commands sit
 * inline around a map of the tab, so a resize or swap is done while looking at
 * the split it changes; each tap applies on the computer and the sheet stays.
 */
export function PaneContextMenu({ modal, model, perform }: {
  modal: ModalController<BoardPaneAction>;
  model: PaneMenuModel;
  anchor: PaneMenuAnchor;
  perform(action: BoardLayoutAction): Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  useDialogLifecycle({ dialog: modal.dialog, onDismiss: modal.dismiss, onClose: modal.finish, cancelGuardMs: 0 });

  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const place = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const safe = getComputedStyle(modal.dialog.current!);
      const minX = left + (parseFloat(safe.paddingLeft) || 12);
      const maxX = left + width - (parseFloat(safe.paddingRight) || 12);
      const minY = top + (parseFloat(safe.paddingTop) || 12);
      const maxY = top + height - (parseFloat(safe.paddingBottom) || 12);
      element.style.maxHeight = `${Math.max(80, maxY - minY)}px`;
      element.style.width = `${Math.min(440, maxX - minX)}px`;
      const rect = element.getBoundingClientRect();
      element.dataset.sheet = "true";
      element.style.left = `${minX + (maxX - minX - rect.width) / 2}px`;
      element.style.top = `${maxY - rect.height}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [modal]);

  useLayoutEffect(() => { content.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus(); }, []);

  function navigate(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      modal.dismiss();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...content.current!.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)")];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }

  async function adjust(action: BoardLayoutAction) {
    if (pendingRef.current || layoutActionReason(model, action)) return;
    pendingRef.current = true;
    setPending(true);
    try { await perform(action); } finally { pendingRef.current = false; setPending(false); }
  }

  const entry = (id: BoardPaneAction) => model.entries.find(item => item.id === id);
  const item = (id: Exclude<BoardPaneAction, "resize" | "swap">, className = "board-menu-item") => {
    const found = entry(id);
    if (!found) return null;
    const Icon = icons[id];
    return <button type="button" role="menuitem" key={id} disabled={!!found.reason} title={found.reason}
      className={`${className}${found.danger ? " danger" : ""}`} onClick={() => modal.close(id)}>
      <Icon size={17} aria-hidden="true" /><span>{found.label}</span>
    </button>;
  };
  const grid = (kind: "resize" | "swap") => {
    const found = entry(kind);
    if (!found) return null;
    return <section className="board-menu-section" key={kind}>
      <h3 className="board-menu-section-title">{found.label}</h3>
      <div className="board-menu-grid">
        {layoutButtons[kind].map(button => {
          const action = { kind, direction: button.direction };
          const reason = found.reason || layoutActionReason(model, action);
          return <button type="button" role="menuitem" className="board-menu-dir" key={button.direction}
            disabled={pending || !!reason} title={reason} onClick={() => void adjust(action)}>{t(button.label)}</button>;
        })}
      </div>
    </section>;
  };
  const splits = [item("right", "board-menu-split"), item("down", "board-menu-split")].filter(Boolean);

  return <dialog ref={modal.dialog} className="board-menu-overlay" data-react-modal="" aria-labelledby={modal.titleId} onContextMenu={event => event.preventDefault()}>
    <div ref={content} className="board-context-menu" onKeyDown={navigate}>
      <div className="board-menu-grabber" aria-hidden="true" />
      <div className="board-menu-heading">
        <PaneMinimap layout={model.layout} paneId={model.paneId} />
        <div className="board-menu-names">
          <strong id={modal.titleId}>{model.title}</strong><span>{model.subtitle}</span>
        </div>
      </div>
      <div role="menu" aria-labelledby={modal.titleId}>
        <div className="board-menu-card">{item("open")}</div>
        {splits.length ? <div className="board-menu-row">{splits}</div> : null}
        {grid("resize")}
        {grid("swap")}
        {(entry("resize") || entry("swap")) && <p className="board-menu-hint">{t("boardMenu.resizeHint")}</p>}
        <div className="board-menu-card">{item("zoom")}{item("rename")}</div>
        <div className="board-menu-card">{item("close")}</div>
        <button type="button" className="board-menu-done" onClick={modal.dismiss}>{t("boardMenu.done")}</button>
      </div>
      <p className="board-menu-notice" role="status" hidden={!pending && !model.disabledReason && !model.notice}>
        {pending ? t("boardMenu.busy") : model.disabledReason || model.notice}
      </p>
    </div>
  </dialog>;
}
