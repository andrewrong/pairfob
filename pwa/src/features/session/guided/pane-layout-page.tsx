import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LayoutGrid } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { agentTitle, type DashboardAgentCard as AgentCard } from "../../../lib/dashboard";
import { t } from "../../../lib/i18n";
import type { LayoutDirection } from "../../../lib/operations";
import type { TabLayoutView } from "../../../lib/layout";
import { directionalPanes, layoutActionReason, type BoardLayoutAction, type PaneMenuModel } from "../../board/model/pane-menu";
import { useBoard } from "../../board/hooks";
import { liveAgents } from "../../dashboard/catalog-store";
import { useDashboard } from "../../dashboard/hooks";
import { layoutSelectedPane } from "../../operations/controller";
import { useCapabilities } from "../../operations/hooks";
import { useConnection } from "../../connection/hooks";
import { openPane } from "../../connection/controller";
import { liveSession } from "../../computers/catalog-store";
import { usePreferences } from "../../settings/hooks";
import { openBoard } from "../../../pages/board/board-bridge";
import { MenuGroup, MenuRow, MenuSetting, MenuSwitch } from "../../../shared/ui/overlay/menu-controls";
import type { ActionSheetController } from "../../../shared/ui/overlay/action-sheet";
import { Button } from "../../../shared/ui/primitives";
import { PanePage } from "./pane-page";

const RESIZE_STEP = 0.15;
/** A drag shorter than this is a tap on the divider, not a resize. */
const MIN_DRAG = 0.02;
const LONG_PRESS_MS = 450;
const SLOP_PX = 8;
const SWAPS: Array<{ direction: LayoutDirection; label: "form.swapLeft" | "form.swapRight" | "form.swapUp" | "form.swapDown"; Icon: typeof ArrowLeft }> = [
  { direction: "left", label: "form.swapLeft", Icon: ArrowLeft }, { direction: "right", label: "form.swapRight", Icon: ArrowRight },
  { direction: "up", label: "form.swapUp", Icon: ArrowUp }, { direction: "down", label: "form.swapDown", Icon: ArrowDown },
];

/** A pane's cell in percent of the tab area. */
export type CellBox = { paneId: string; x: number; y: number; width: number; height: number };

/** The tab as the desk draws it, in percent; a zoomed tab shows only the filled pane. */
export function layoutBoxes(layout: TabLayoutView, paneId: string): CellBox[] {
  const { area } = layout;
  if (layout.zoomed) return layout.panes.filter(pane => pane.paneId === paneId).map(pane => ({ paneId: pane.paneId, x: 0, y: 0, width: 100, height: 100 }));
  return layout.panes.map(pane => ({
    paneId: pane.paneId,
    x: ((pane.rect.x - area.x) / area.width) * 100, y: ((pane.rect.y - area.y) / area.height) * 100,
    width: (pane.rect.width / area.width) * 100, height: (pane.rect.height / area.height) * 100,
  }));
}

/** Terminal cells are about twice as tall as wide; the preview keeps the desk's proportions. */
export function layoutRatio(layout: TabLayoutView | null): number {
  if (!layout) return 1.6;
  return Math.min(2.4, Math.max(0.8, (layout.area.width / Math.max(1, layout.area.height)) / 2));
}

export function cellStyle(box: Pick<CellBox, "x" | "y" | "width" | "height">) {
  return { left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` };
}

/** The layout of the tab this pane sits in, from the board's snapshot. */
export function useTabLayout(agent: Pick<AgentCard, "workspaceId" | "tabId"> | undefined): TabLayoutView | null {
  const board = useBoard();
  if (!agent) return null;
  return board.layouts.find(item => item.workspaceId === agent.workspaceId && item.tabId === agent.tabId) ?? null;
}

/** The divider on this cell's edge that faces a neighbour: one per axis, or none. */
function dividers(layout: TabLayoutView, paneId: string): { width?: "left" | "right"; height?: "up" | "down" } {
  const has = (direction: LayoutDirection) => directionalPanes(layout, paneId, direction).length > 0;
  return {
    width: has("right") ? "right" : has("left") ? "left" : undefined,
    height: has("down") ? "down" : has("up") ? "up" : undefined,
  };
}

type Drag = { axis: "width" | "height"; value: number };

/**
 * Layout, pushed inside the pane sheet. The preview is the control: drag the
 * divider on this cell's edge (one resize on release), long-press this cell
 * and drop it on a neighbour to swap, tap another cell to open it. Every
 * mutation carries its own operation id (never retried) and the preview
 * redraws from the refreshed snapshot rather than guessing the result. The
 * old steppers stay under "Fine adjustments" for keyboard and screen readers.
 */
export function PaneLayoutPage({ modal, agent }: { modal: ActionSheetController; agent: AgentCard }) {
  const { operationBusy, operationCapabilities: caps } = useCapabilities();
  const agents = useDashboard().agents;
  const { listGroup } = usePreferences();
  const { networkOnline } = useConnection();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const pendingRef = useRef(false);
  const layout = useTabLayout(agent);
  const model: PaneMenuModel = { title: "", subtitle: "", entries: [], notice: "", layout, paneId: agent.paneId,
    disabledReason: !networkOnline || !liveSession()?.isConnected() ? t("boardMenu.offline")
      : operationBusy || pending ? t("boardMenu.busy") : "" };
  const split = !!layout && layout.panes.length > 1;
  const valid = () => liveAgents().some(pane => pane.paneId === agent.paneId && pane.tabId === agent.tabId);

  const run = async (work: () => Promise<unknown>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setMessage("");
    try { await work(); } finally { pendingRef.current = false; setPending(false); }
  };
  const adjust = (action: BoardLayoutAction, amount = RESIZE_STEP) => {
    if (layoutActionReason(model, action)) return;
    void run(() => layoutSelectedPane(action.kind, agent, { valid, choice: action.kind === "resize"
      ? { kind: "resize", direction: action.direction, amount } : { kind: "swap", direction: action.direction } }));
  };
  const blocked = (action: BoardLayoutAction) => !!layoutActionReason(model, action);
  const pane = layout?.panes.find(item => item.paneId === agent.paneId);
  const share = (part: number, whole: number) => t("layout.share", { n: Math.round((part / whole) * 100) });
  const title = (id: string) => { const item = agents.find(card => card.paneId === id); return item ? agentTitle(item, listGroup) : ""; };
  const canFill = caps.zoom_pane && (split || !!layout?.zoomed);

  return <PanePage className="pane-layout">
    {layout && <LayoutCanvas layout={layout} paneId={agent.paneId} title={title} disabled={!!model.disabledReason}
      canResize={caps.resize_pane && split && !layout.zoomed} canSwap={caps.swap_pane && split && !layout.zoomed}
      onResize={(direction, amount) => adjust({ kind: "resize", direction }, amount)}
      onSwap={(direction) => {
        if (!direction) { setMessage(t("pm.swapNoNeighbor")); return; }
        adjust({ kind: "swap", direction });
      }}
      onOpen={(paneId) => modal.close(() => void openPane(paneId))} />}
    {!split && !layout?.zoomed ? <p className="pane-layout-single">{t("pm.single")}</p>
      : <p className="pane-layout-hint">{t(layout?.zoomed ? "pm.layoutZoomHint" : "pm.layoutHint")}</p>}
    {!caps.zoom_pane && split && <p className="empty-sub">{t("pane.splitUnsupported")}</p>}
    <MenuGroup>
      {canFill && <MenuSwitch label={t("fill.enter")} checked={!!layout?.zoomed}
        onChange={(on) => { if (!model.disabledReason) void run(() => layoutSelectedPane("zoom", agent, { valid, zoomMode: on ? "on" : "off" })); }} />}
      <MenuRow icon={<LayoutGrid size={18} />} label={t("pm.board")} next modal={modal}
        action={() => openBoard({ workspaceId: agent.workspaceId, tabId: agent.tabId })} />
    </MenuGroup>
    {split && !layout?.zoomed && (caps.resize_pane || caps.swap_pane) && <details className="pane-precise">
      <summary>{t("pm.precise")}</summary>
      {caps.resize_pane && pane && <MenuGroup className="pane-layout-resize">
        {([["layout.width", "left", "right", "form.narrower", "form.wider", share(pane.rect.width, layout!.area.width)],
          ["layout.height", "down", "up", "form.shorter", "form.taller", share(pane.rect.height, layout!.area.height)]] as const)
          .map(([label, less, more, lessLabel, moreLabel, value]) => <MenuSetting key={label} label={t(label)}>
            <div className="menu-stepper" role="group" aria-label={t(label)}>
              <Button className="menu-stepper-btn" aria-label={t(lessLabel)} disabled={blocked({ kind: "resize", direction: less })}
                onClick={() => adjust({ kind: "resize", direction: less })}>−</Button>
              <output className="menu-stepper-value" aria-live="polite">{value}</output>
              <Button className="menu-stepper-btn" aria-label={t(moreLabel)} disabled={blocked({ kind: "resize", direction: more })}
                onClick={() => adjust({ kind: "resize", direction: more })}>+</Button>
            </div>
          </MenuSetting>)}
      </MenuGroup>}
      {caps.swap_pane && <MenuGroup className="pane-layout-swap">
        <div className="menu-setting-label">{t("layout.swap")}</div>
        <div className="pane-swap-grid">
          {SWAPS.map(({ direction, label, Icon }) => <Button key={direction} className="pane-swap" disabled={blocked({ kind: "swap", direction })}
            aria-label={t(label)} onClick={() => adjust({ kind: "swap", direction })}><Icon size={18} aria-hidden="true" /></Button>)}
        </div>
      </MenuGroup>}
    </details>}
    <p className="pane-layout-status" role="status">{model.disabledReason || message}</p>
  </PanePage>;
}

/**
 * The interactive preview. Draft sizes live only in this component while a
 * finger is down; the committed layout always comes from the snapshot.
 */
function LayoutCanvas({ layout, paneId, title, disabled, canResize, canSwap, onResize, onSwap, onOpen }: {
  layout: TabLayoutView; paneId: string; title: (paneId: string) => string; disabled: boolean;
  canResize: boolean; canSwap: boolean;
  onResize: (direction: LayoutDirection, amount: number) => void;
  onSwap: (direction: LayoutDirection | null) => void;
  onOpen: (paneId: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lift, setLift] = useState<{ dx: number; dy: number; target: string } | null>(null);
  const press = useRef<{ x: number; y: number; timer: number; lifted: boolean } | null>(null);
  const boxes = layoutBoxes(layout, paneId);
  const own = boxes.find(box => box.paneId === paneId);
  const edges = canResize ? dividers(layout, paneId) : {};
  // While dragging, this cell grows or shrinks from the divider's edge.
  const shown = own && drag ? resized(own, drag, drag.axis === "width" ? edges.width : edges.height) : own;

  const point = (event: { clientX: number; clientY: number }) => {
    const rect = root.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100, y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100 };
  };
  const cellAt = (x: number, y: number) => boxes.find(box => box.paneId !== paneId
    && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height)?.paneId ?? "";

  const startDivider = (axis: "width" | "height") => (event: ReactPointerEvent) => {
    if (disabled || !own) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ axis, value: own[axis] });
  };
  const moveDivider = (event: ReactPointerEvent) => {
    if (!drag || !own) return;
    const at = point(event);
    const edge = drag.axis === "width" ? edges.width : edges.height;
    const start = drag.axis === "width" ? own.x : own.y;
    const end = start + own[drag.axis];
    const pos = Math.min(95, Math.max(5, drag.axis === "width" ? at.x : at.y));
    // The far edge stays put; the divider's edge follows the finger.
    const value = edge === "right" || edge === "down" ? pos - start : end - pos;
    setDrag({ axis: drag.axis, value: Math.max(5, value) });
  };
  const endDivider = () => {
    if (!drag || !own) return;
    const delta = (drag.value - own[drag.axis]) / 100;
    setDrag(null);
    if (Math.abs(delta) < MIN_DRAG) return;
    // The daemon's resize names the growth, like the steppers: wider is
    // "right", taller is "up"; the amount is the share of the tab.
    const direction: LayoutDirection = drag.axis === "width" ? (delta > 0 ? "right" : "left") : (delta > 0 ? "up" : "down");
    onResize(direction, Math.min(1, Math.abs(delta)));
  };
  const dividerKey = (axis: "width" | "height") => (event: KeyboardEvent) => {
    const grow = axis === "width" ? event.key === "ArrowRight" : event.key === "ArrowUp";
    const shrink = axis === "width" ? event.key === "ArrowLeft" : event.key === "ArrowDown";
    if (!grow && !shrink) return;
    event.preventDefault();
    if (!disabled) onResize(axis === "width" ? (grow ? "right" : "left") : (grow ? "up" : "down"), RESIZE_STEP);
  };

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setLift(null);
  };
  const pressDown = (event: ReactPointerEvent) => {
    if (disabled || !canSwap) return;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    press.current = { ...start, lifted: false, timer: window.setTimeout(() => {
      if (!press.current) return;
      press.current.lifted = true;
      target.setPointerCapture?.(pointerId);
      setLift({ dx: 0, dy: 0, target: "" });
    }, LONG_PRESS_MS) };
  };
  const pressMove = (event: ReactPointerEvent) => {
    const state = press.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.lifted) { if (Math.hypot(dx, dy) > SLOP_PX) cancelPress(); return; }
    const at = point(event);
    setLift({ dx, dy, target: cellAt(at.x, at.y) });
  };
  const pressUp = () => {
    const target = lift?.target;
    const lifted = press.current?.lifted;
    cancelPress();
    if (!lifted || !target) return;
    const direction = (["left", "right", "up", "down"] as const)
      .find(item => directionalPanes(layout, paneId, item).includes(target)) ?? null;
    onSwap(direction);
  };

  return <div ref={root} className={`pane-layout-preview${drag || lift ? " is-dragging" : ""}`} role="group" aria-label={t("layout.previewAria")}
    style={{ aspectRatio: String(layoutRatio(layout)) }}>
    {boxes.map(box => {
      if (box.paneId === paneId) {
        const size = shown && drag ? Math.round(shown[drag.axis]) : null;
        return <span key={box.paneId} className={`pane-layout-cell is-current${lift ? " is-lifted" : ""}`}
          style={{ ...cellStyle(shown ?? box), ...(lift ? { transform: `translate(${lift.dx}px, ${lift.dy}px)` } : {}) }}
          onPointerDown={pressDown} onPointerMove={pressMove} onPointerUp={pressUp} onPointerCancel={cancelPress}
          onContextMenu={event => event.preventDefault()}>
          <span><b>{t("pane.thisCell")}</b>{size !== null && <em>{size}%</em>}</span>
        </span>;
      }
      return <button key={box.paneId} type="button" className={`pane-layout-cell is-other${lift?.target === box.paneId ? " is-target" : ""}`}
        style={cellStyle(box)} aria-label={t("board.paneAria", { title: title(box.paneId) })} onClick={() => onOpen(box.paneId)}>
        <span><b>{title(box.paneId)}</b></span>
      </button>;
    })}
    {shown && edges.width && <span className="pane-divider is-v" role="slider" tabIndex={disabled ? -1 : 0} aria-label={t("pm.dividerWidth")}
      aria-orientation="horizontal" aria-valuemin={5} aria-valuemax={95} aria-valuenow={Math.round(shown.width)} aria-disabled={disabled}
      style={{ left: `${edges.width === "right" ? shown.x + shown.width : shown.x}%`, top: `${shown.y}%`, height: `${shown.height}%` }}
      onPointerDown={startDivider("width")} onPointerMove={moveDivider} onPointerUp={endDivider} onPointerCancel={() => setDrag(null)}
      onKeyDown={dividerKey("width")} />}
    {shown && edges.height && <span className="pane-divider is-h" role="slider" tabIndex={disabled ? -1 : 0} aria-label={t("pm.dividerHeight")}
      aria-orientation="vertical" aria-valuemin={5} aria-valuemax={95} aria-valuenow={Math.round(shown.height)} aria-disabled={disabled}
      style={{ top: `${edges.height === "down" ? shown.y + shown.height : shown.y}%`, left: `${shown.x}%`, width: `${shown.width}%` }}
      onPointerDown={startDivider("height")} onPointerMove={moveDivider} onPointerUp={endDivider} onPointerCancel={() => setDrag(null)}
      onKeyDown={dividerKey("height")} />}
  </div>;
}

function resized(box: CellBox, drag: Drag, edge: LayoutDirection | undefined): CellBox {
  if (drag.axis === "width") return edge === "left" ? { ...box, x: box.x + box.width - drag.value, width: drag.value } : { ...box, width: drag.value };
  return edge === "up" ? { ...box, y: box.y + box.height - drag.value, height: drag.value } : { ...box, height: drag.value };
}
