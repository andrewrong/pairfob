import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowRight, ArrowLeftRight, ChevronRight, Maximize, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { t } from "../../../lib/i18n";
import type { ModalController } from "../../../shared/ui/overlay/modal";
import { useDialogLifecycle } from "../../../shared/ui/overlay/dialog-lifecycle";
import { layoutActionReason, layoutButtons, type BoardLayoutAction, type BoardPaneAction, type PaneMenuModel } from "../model/pane-menu";

export type PaneMenuAnchor = { x: number; y: number };
const icons = { open: ArrowRight, right: Plus, down: ArrowDown, resize: SlidersHorizontal,
  swap: ArrowLeftRight, zoom: Maximize, rename: Pencil, close: Trash2 };

export function PaneContextMenu({ modal, model, anchor, perform }: {
  modal: ModalController<BoardPaneAction>;
  model: PaneMenuModel;
  anchor: PaneMenuAnchor;
  perform(action: BoardLayoutAction): Promise<void>;
}) {
  const [panel, setPanel] = useState<"main" | "resize" | "swap">("main");
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
      element.style.width = `${Math.min(280, maxX - minX)}px`;
      const rect = element.getBoundingClientRect();
      const sheet = height < 560 || rect.height > height - 80;
      element.dataset.sheet = String(sheet);
      const x = sheet ? minX + (maxX - minX - rect.width) / 2 : Math.max(minX, Math.min(anchor.x + 12, maxX - rect.width));
      const preferredY = anchor.y - rect.height - 16;
      const y = sheet ? maxY - rect.height
        : Math.max(minY, Math.min(preferredY >= minY ? preferredY : anchor.y + 16, maxY - rect.height));
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
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
  }, [anchor, modal]);

  useLayoutEffect(() => { content.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus(); }, [panel]);
  useLayoutEffect(() => {
    if (panel !== "main" && (!model.entries.some(entry => entry.id === panel) || model.layout?.zoomed)) setPanel("main");
  }, [model.entries, panel]);

  function navigate(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (panel !== "main") setPanel("main"); else modal.dismiss();
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

  return <dialog ref={modal.dialog} className="board-menu-overlay" data-react-modal="" aria-labelledby={modal.titleId} onContextMenu={event => event.preventDefault()}>
    <div ref={content} className="board-context-menu" onKeyDown={navigate}>
      <div className="board-menu-heading">
        <strong id={modal.titleId}>{model.title}</strong><span>{model.subtitle}</span>
      </div>
      <div role="menu" aria-labelledby={modal.titleId}>
        {panel === "main" ? model.entries.map((entry, index) => {
          const Icon = icons[entry.id];
          return <button type="button" role="menuitem" key={entry.id} disabled={!!entry.reason}
            title={entry.reason} className={`board-menu-item${entry.danger ? " danger" : ""}${index && model.entries[index - 1].group !== entry.group ? " divided" : ""}`}
            onClick={() => entry.id === "resize" || entry.id === "swap" ? setPanel(entry.id) : modal.close(entry.id)}>
            <Icon size={18} aria-hidden="true" /><span>{entry.label}</span>
            {(entry.id === "resize" || entry.id === "swap") && <ChevronRight size={16} aria-hidden="true" />}
          </button>;
        }) : <>
          <button type="button" role="menuitem" className="board-menu-item" onClick={() => setPanel("main")}>← {t("boardMenu.back")}</button>
          <p className="board-menu-hint">{t(panel === "resize" ? "boardMenu.resizeHint" : "boardMenu.swapHint")}</p>
          {layoutButtons[panel].map(button => {
            const action = { kind: panel, direction: button.direction };
            const reason = layoutActionReason(model, action);
            return <button type="button" role="menuitem" className="board-menu-item" key={button.direction}
              disabled={pending || !!reason} title={reason} onClick={() => void adjust(action)}>{t(button.label)}</button>;
          })}
          <button type="button" role="menuitem" className="board-menu-item divided" onClick={modal.dismiss}>{t("boardMenu.done")}</button>
        </>}
      </div>
      <p className="board-menu-notice" role="status" hidden={!pending && !model.disabledReason && !model.notice}>
        {pending ? t("boardMenu.busy") : model.disabledReason || model.notice}
      </p>
    </div>
  </dialog>;
}
