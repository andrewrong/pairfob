import { useEffect } from "react";
import { currentScreen, navigationStore } from "../../app/navigation-store";
import { noticesStore, showStatus } from "../../app/notices-store";
import { agentStatusLabel, agentTitle } from "../../lib/dashboard";
import { t } from "../../lib/i18n";
import { boardStore, liveBoardCatalog } from "../../features/board/layout-store";
import { boardInteractionStore, clearBoardInteraction, highlightBoardPane } from "../../features/board/interaction-store";
import { liveSession, computersStore, currentDaemonId } from "../../features/computers/catalog-store";
import { connectionStore, networkOnline } from "../../features/connection/connection-store";
import { dashboardStore, liveAgents } from "../../features/dashboard/catalog-store";
import { capabilitiesStore, operationBusy, operationCapabilities } from "../../features/operations/capabilities-store";
import { closePane, layoutSelectedPane, renamePane, splitSelectedPane } from "../../features/operations/controller";
import { PaneContextMenu, type PaneMenuAnchor } from "../../features/board/components/pane-context-menu";
import { layoutActionReason, paneMenuEntries, type BoardLayoutAction, type BoardPaneAction, type PaneMenuModel } from "../../features/board/model/pane-menu";
import { presentModal, type ModalController } from "../../shared/ui/overlay/modal";
import { createDomainUpdates, useDomainUpdates } from "../domain-updates";

const updates = createDomainUpdates([
  { store: navigationStore }, { store: boardStore }, { store: dashboardStore },
  { store: computersStore }, { store: connectionStore }, { store: capabilitiesStore }, { store: noticesStore },
]);

type MenuDriver = { valid(): boolean; read(): PaneMenuModel; perform(action: BoardLayoutAction): Promise<void> };

function LivePaneMenu({ modal, anchor, driver }: { modal: ModalController<BoardPaneAction>; anchor: PaneMenuAnchor; driver: MenuDriver }) {
  useDomainUpdates(updates);
  const valid = driver.valid();
  useEffect(() => {
    if (!valid) queueMicrotask(() => {
      modal.dismiss();
      if (currentScreen() === "board") showStatus(t("boardMenu.targetGone"));
    });
  }, [valid, modal]);
  return <PaneContextMenu modal={modal} anchor={anchor} model={driver.read()} perform={driver.perform} />;
}

/** Capture identity once; never select a session pane just to operate on a tile. */
export async function openBoardPaneMenu(paneId: string, anchor: PaneMenuAnchor, tile: HTMLElement,
  ports: { openPane(paneId: string, tile?: HTMLElement): void; revealPane(paneId: string): void }): Promise<void> {
  const session = liveSession();
  const daemonId = currentDaemonId();
  const catalog = liveBoardCatalog();
  const agent = liveAgents().find(pane => pane.paneId === paneId && pane.tabId === catalog.tabId && pane.workspaceId === catalog.workspaceId);
  if (!agent || !agent.tabId || !session || currentScreen() !== "board") return;
  const tabId = agent.tabId;
  let invalidated = false;
  const valid = () => {
    const current = liveBoardCatalog();
    invalidated ||= liveSession() !== session || currentDaemonId() !== daemonId || currentScreen() !== "board"
      || current.tabId !== catalog.tabId || current.workspaceId !== catalog.workspaceId
      || !liveAgents().some(pane => pane.paneId === paneId && pane.tabId === agent.tabId && pane.workspaceId === agent.workspaceId);
    return !invalidated;
  };
  // Observe departures even if a caller changes tabs and returns before React paints.
  const releaseScope = updates.subscribe(() => { valid(); });
  const read = (): PaneMenuModel => {
    const current = liveAgents().find(pane => pane.paneId === paneId) ?? agent;
    const layout = liveBoardCatalog().layouts.find(layout => layout.tabId === agent.tabId) ?? null;
    const disabledReason = !session.isConnected() || !networkOnline() ? t("boardMenu.offline")
      : operationBusy() ? t("boardMenu.busy") : "";
    return { title: agentTitle(current), subtitle: `${agentStatusLabel(current)} · ${current.tabLabel || current.tabId}`,
      paneId, layout, disabledReason, entries: paneMenuEntries(operationCapabilities(), layout, disabledReason),
      notice: noticesStore.get().notice?.text ?? "" };
  };
  const perform = async (action: BoardLayoutAction) => {
    const model = read();
    if (!valid() || layoutActionReason(model, action) || !model.entries.some(entry => entry.id === action.kind && !entry.reason)) return;
    await layoutSelectedPane(action.kind, agent, { valid, choice: action.kind === "resize"
      ? { kind: "resize", direction: action.direction, amount: 0.15 } : { kind: "swap", direction: action.direction } });
  };
  const trigger = tile.querySelector<HTMLElement>(".board-pane-open") ?? tile;
  if (!tile.contains(document.activeElement)) trigger.focus({ preventScroll: true });
  highlightBoardPane(paneId, tabId);
  try {
    const modal = presentModal<BoardPaneAction>(modal => <LivePaneMenu modal={modal} anchor={anchor} driver={{ valid, read, perform }} />,
      { replaceKey: "board-pane-menu" });
    const action = await modal.result;
    if (!action || !valid()) return;
    const model = read();
    if (!model.entries.some(entry => entry.id === action && !entry.reason)) return;
    const options = { valid };
    switch (action) {
      case "open": ports.openPane(paneId, tile); break;
      case "right": case "down":
        await splitSelectedPane(agent, { ...options, direction: action, created: id => {
          highlightBoardPane(id, tabId, true);
          requestAnimationFrame(() => { if (valid()) ports.revealPane(id); });
        } });
        break;
      case "zoom": await layoutSelectedPane("zoom", agent, { ...options, zoomMode: model.layout?.zoomed ? "off" : "on" }); break;
      case "rename": await renamePane(agent, options); break;
      case "close": await closePane(agent, options); break;
    }
  } finally {
    releaseScope();
    // A created-pane notice owns its own highlight lifetime.
    if (!boardInteractionStore.get().createdPaneId) clearBoardInteraction();
    if (currentScreen() === "board" && !document.querySelector("dialog[open]")) {
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>(".board-pane-open, .board-tab")?.focus({ preventScroll: true });
    }
  }
}
