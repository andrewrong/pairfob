import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LayoutGrid, Maximize, Minimize } from "lucide-react";
import { useRef, useState } from "react";
import { agentTitle, type DashboardAgentCard as AgentCard } from "../../../lib/dashboard";
import { t } from "../../../lib/i18n";
import type { LayoutDirection } from "../../../lib/operations";
import { layoutActionReason, type BoardLayoutAction, type PaneMenuModel } from "../../board/model/pane-menu";
import { useBoard } from "../../board/hooks";
import { liveAgents } from "../../dashboard/catalog-store";
import { useDashboard } from "../../dashboard/hooks";
import { layoutSelectedPane } from "../../operations/controller";
import { useCapabilities } from "../../operations/hooks";
import { useConnection } from "../../connection/hooks";
import { liveSession } from "../../computers/catalog-store";
import { openBoard } from "../../../pages/board/board-bridge";
import { MenuGroup, MenuRow, MenuSetting } from "../../../shared/ui/overlay/menu-controls";
import type { ActionSheetController } from "../../../shared/ui/overlay/action-sheet";
import { Button } from "../../../shared/ui/primitives";

const RESIZE_STEP = 0.15;
const SWAPS: Array<{ direction: LayoutDirection; label: "form.swapLeft" | "form.swapRight" | "form.swapUp" | "form.swapDown"; Icon: typeof ArrowLeft }> = [
  { direction: "left", label: "form.swapLeft", Icon: ArrowLeft }, { direction: "right", label: "form.swapRight", Icon: ArrowRight },
  { direction: "up", label: "form.swapUp", Icon: ArrowUp }, { direction: "down", label: "form.swapDown", Icon: ArrowDown },
];

/**
 * Layout and size, pushed inside the pane sheet. Every tap is one layout
 * mutation with its own operation id (never retried); the panel only stays
 * open so the reader can keep adjusting, and the preview redraws from the
 * refreshed snapshot rather than guessing the result.
 */
export function PaneLayoutPage({ modal, agent }: { modal: ActionSheetController; agent: AgentCard }) {
  const board = useBoard();
  const { operationBusy, operationCapabilities: caps } = useCapabilities();
  const agents = useDashboard().agents;
  const { networkOnline } = useConnection();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const layout = board.layouts.find(item => item.workspaceId === agent.workspaceId && item.tabId === agent.tabId) ?? null;
  const model: PaneMenuModel = { title: "", subtitle: "", entries: [], notice: "", layout, paneId: agent.paneId,
    disabledReason: !networkOnline || !liveSession()?.isConnected() ? t("boardMenu.offline")
      : operationBusy || pending ? t("boardMenu.busy") : "" };
  const split = !!layout && layout.panes.length > 1;
  const valid = () => liveAgents().some(pane => pane.paneId === agent.paneId && pane.tabId === agent.tabId);

  const run = async (work: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try { await work(); } finally { pendingRef.current = false; setPending(false); }
  };
  const adjust = (action: BoardLayoutAction) => {
    if (layoutActionReason(model, action)) return;
    void run(() => layoutSelectedPane(action.kind, agent, { valid, choice: action.kind === "resize"
      ? { kind: "resize", direction: action.direction, amount: RESIZE_STEP } : { kind: "swap", direction: action.direction } }));
  };
  const blocked = (action: BoardLayoutAction) => !!layoutActionReason(model, action);
  const pane = layout?.panes.find(item => item.paneId === agent.paneId);
  const share = (part: number, whole: number) => t("layout.share", { n: Math.round((part / whole) * 100) });

  return <div className="pane-layout">
    {layout && <LayoutPreview layout={layout} paneId={agent.paneId}
      title={id => { const item = agents.find(card => card.paneId === id); return item ? agentTitle(item) : ""; }} />}
    {!split && !layout?.zoomed && <p className="empty-sub">{t("layout.single")}</p>}
    {caps.resize_pane && split && pane && <MenuGroup className="pane-layout-resize">
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
    {caps.swap_pane && split && <MenuGroup className="pane-layout-swap">
      <div className="menu-setting-label">{t("layout.swap")}</div>
      <div className="pane-swap-grid">
        {SWAPS.map(({ direction, label, Icon }) => <Button key={direction} className="pane-swap" disabled={blocked({ kind: "swap", direction })}
          aria-label={t(label)} onClick={() => adjust({ kind: "swap", direction })}><Icon size={18} aria-hidden="true" /></Button>)}
      </div>
    </MenuGroup>}
    {!caps.zoom_pane && split && <p className="empty-sub">{t("pane.splitUnsupported")}</p>}
    <MenuGroup>
      {caps.zoom_pane && (split || layout?.zoomed) && <MenuRow icon={layout?.zoomed ? <Minimize size={18} /> : <Maximize size={18} />}
        label={t(layout?.zoomed ? "fill.exit" : "fill.enter")} disabled={!!model.disabledReason}
        onClick={() => void run(() => layoutSelectedPane("zoom", agent, { valid, zoomMode: layout?.zoomed ? "off" : "on" }))} />}
      <MenuRow icon={<LayoutGrid size={18} />} label={t("menu.board")} modal={modal}
        action={() => openBoard({ workspaceId: agent.workspaceId, tabId: agent.tabId })} />
    </MenuGroup>
    <p className="pane-layout-status" role="status">{model.disabledReason || (split ? t("layout.hint") : "")}</p>
  </div>;
}

function LayoutPreview({ layout, paneId, title }: {
  layout: NonNullable<PaneMenuModel["layout"]>; paneId: string; title: (paneId: string) => string;
}) {
  const { area } = layout;
  // Terminal cells are about twice as tall as wide; the preview keeps the desk's proportions.
  const ratio = Math.min(2.4, Math.max(0.8, (area.width / Math.max(1, area.height)) / 2));
  const panes = layout.zoomed ? layout.panes.filter(pane => pane.paneId === paneId) : layout.panes;
  return <div className="pane-layout-preview" role="img" aria-label={t("layout.previewAria")} style={{ aspectRatio: String(ratio) }}>
    {panes.map(pane => {
      const box = layout.zoomed ? { x: 0, y: 0, width: 100, height: 100 } : {
        x: ((pane.rect.x - area.x) / area.width) * 100, y: ((pane.rect.y - area.y) / area.height) * 100,
        width: (pane.rect.width / area.width) * 100, height: (pane.rect.height / area.height) * 100,
      };
      const current = pane.paneId === paneId;
      return <span key={pane.paneId} className={`pane-layout-cell${current ? " is-current" : ""}`}
        style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}>
        <span><b>{current ? t("pane.thisCell") : title(pane.paneId)}</b></span>
      </span>;
    })}
  </div>;
}
