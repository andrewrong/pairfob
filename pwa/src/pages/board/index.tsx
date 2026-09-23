import { boardStore, type BoardRecord } from "../../features/board/layout-store";
import { capabilitiesStore } from "../../features/operations/capabilities-store";
import { computersStore } from "../../features/computers/catalog-store";
import { connectionStore } from "../../features/connection/connection-store";
import { dashboardStore } from "../../features/dashboard/catalog-store";
import { runtimeStore } from "../../features/connection/runtime-store";
import { sessionStore } from "../../features/session/session-store";
import { BoardScreenView } from "../../features/board/components/board-screen";
import { buildBoardViewModel } from "../../features/board/model/board-view";
import { createDomainUpdates, useDomainUpdates, type DomainWatch } from "../domain-updates";
import { boardActions, boardCanvasController, readBoardInput } from "./board-bridge";
import { useEffect } from "react";
import { boardInteractionStore, clearBoardInteraction } from "../../features/board/interaction-store";
import { t } from "../../lib/i18n";

/**
 * Board route.
 *
 * The page subscribes to the domains whose data it renders and re-renders when
 * one of them publishes — a workspace or tab selection needs no manual repaint.
 * The board domain also owns the camera, which a pan or pinch writes many times
 * a second, so that watch is keyed on the catalog the screen actually shows:
 * camera-only publishes never reach React. The canvas reads and writes the camera
 * imperatively through its controller.
 *
 * Render is a pure projection of already-committed snapshots. Facade writes are
 * published at imperative boundaries (`presentBoardView`, toolbar actions), never
 * from this function's body.
 */
function boardDisplayKey(board: BoardRecord): string {
  const spaces = board.workspaceList.map((space) => `${space.id}\u0001${space.label}`).join("\u0002");
  const tabs = board.tabList.map((tab) => `${tab.id}\u0001${tab.workspaceId}\u0001${tab.label}`).join("\u0002");
  return `${board.boardWorkspaceId}\u0000${board.boardTabId}\u0000${board.lastLayoutSig}\u0000${spaces}\u0000${tabs}`;
}

const watches: DomainWatch[] = [
  { store: boardInteractionStore },
  { store: dashboardStore },
  { store: boardStore, keyOf: (snapshot) => boardDisplayKey(snapshot as BoardRecord) },
  { store: capabilitiesStore },
  { store: connectionStore },
  { store: computersStore },
  { store: runtimeStore },
  { store: sessionStore },
];

const updates = createDomainUpdates(watches);

export function BoardPage() {
  useDomainUpdates(updates);
  const view = buildBoardViewModel(readBoardInput());
  const attention = boardInteractionStore.get();
  const sameTab = attention.tabId === view.canvas.tabId;
  const created = sameTab && view.canvas.tiles.some(tile => tile.paneId === attention.createdPaneId) ? attention.createdPaneId : "";
  view.canvas.highlightedPaneId = sameTab ? attention.paneId : "";
  const session = computersStore.get().live;
  useEffect(() => () => clearBoardInteraction(), [view.canvas.tabId, session]);
  return (
    <>
    <BoardScreenView
      view={view}
      actions={boardActions}
      controller={boardCanvasController}
    />
    {created && <div className="board-created-notice" role="status">
      <span>{t("boardMenu.created")}</span>
      <button type="button" onClick={() => { clearBoardInteraction(); boardCanvasController.openPane(created, null); }}>{t("boardMenu.openCreated")}</button>
      <button type="button" aria-label={t("close")} onClick={clearBoardInteraction}>×</button>
    </div>}
    </>
  );
}
