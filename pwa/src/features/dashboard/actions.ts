/**
 * Dashboard feature actions.
 *
 * Narrow, named intents the herd screen can fire. Everything that reads or
 * writes the application record (the collapse map, navigation to the board, the
 * press-time busy/connection guard) arrives through `HerdActionPorts`, so this
 * module and the components above it stay free of the global state bridge.
 */
import { openComputers } from "../computers/actions";
import type { AgentCard } from "../../lib/ranking";
import type { EmptySessionAction } from "../../lib/ui-model";
import { openPane, reconnectLiveSessions } from "../connection/controller";
import { openSettings } from "../settings/actions";

export type HerdActionPorts = {
  /**
   * Read at press time, never at render time: a long press that starts while
   * the app is idle must still be refused once a mutation is in flight.
   */
  canOpenMenu(): boolean;
  /** `groupIds` is the order the clicked list was rendered from. */
  toggleGroup(groupId: string, groupIds: string[]): void;
  openBoard(): void;
  /** Hand the outgoing card title to the view transition that opens the pane. */
  shareTitle(element: HTMLElement | null): void;
  /** Object menus read the record when the press lands, so the page owns them. */
  openPaneMenu(agent: AgentCard): void;
  openWorkspaceMenu(agent: AgentCard): void;
  /** Computer panel behind the header title: switch, retry, details. */
  openHostMenu(): void;
  openGroupModeMenu(): void;
  togglePin(paneId: string): void;
  /** Acknowledge an unread completion without opening the pane. */
  markRead(paneId: string): void;
  /** The create sheet, optionally on one workspace. */
  openCreate(workspace?: AgentCard): void;
  /** Recent agent + workspace combinations, created in one step. */
  openQuickCreate(): void;
};

export type HerdActions = {
  openPaneFromCard(paneId: string, title: HTMLElement | null): void;
  openPaneMenu(agent: AgentCard): void;
  openWorkspaceMenu(agent: AgentCard | undefined): void;
  toggleGroup(groupId: string, groupIds: string[]): void;
  createConversation(): void;
  openBoard(): void;
  openSettings(): void;
  openComputers(): void;
  runEmptyAction(kind: EmptySessionAction): void;
  openHostMenu(): void;
  openGroupModeMenu(): void;
  openAttention(paneId: string): void;
  /** Open the group and scroll to its next waiting / unread row. The screen owns this. */
  revealAttention(groupId: string, kind: "blocked" | "done"): void;
  createInWorkspace(agent: AgentCard | undefined): void;
  openCreate(): void;
  openQuickCreate(): void;
  togglePin(paneId: string): void;
  markRead(paneId: string): void;
};

export function createHerdActions(ports: HerdActionPorts): HerdActions {
  return {
    openPaneFromCard(paneId, title) {
      ports.shareTitle(title);
      void openPane(paneId);
    },
    openPaneMenu(agent) {
      if (!ports.canOpenMenu()) return;
      ports.openPaneMenu(agent);
    },
    openWorkspaceMenu(agent) {
      if (!agent || !ports.canOpenMenu()) return;
      ports.openWorkspaceMenu(agent);
    },
    toggleGroup(groupId, groupIds) {
      ports.toggleGroup(groupId, groupIds);
    },
    createConversation() {
      ports.openCreate();
    },
    openBoard() {
      ports.openBoard();
    },
    openSettings() {
      openSettings();
    },
    openComputers() {
      openComputers();
    },
    openHostMenu() {
      ports.openHostMenu();
    },
    openGroupModeMenu() {
      ports.openGroupModeMenu();
    },
    openAttention(paneId) {
      void openPane(paneId);
    },
    revealAttention() {
      // Replaced by the screen, which owns the fold and the scroll.
    },
    createInWorkspace(agent) {
      if (agent) ports.openCreate(agent);
    },
    openCreate() {
      ports.openCreate();
    },
    openQuickCreate() {
      ports.openQuickCreate();
    },
    togglePin(paneId) {
      ports.togglePin(paneId);
    },
    markRead(paneId) {
      ports.markRead(paneId);
    },
    runEmptyAction(kind) {
      if (kind === "create") ports.openCreate();
      else if (kind === "retry") reconnectLiveSessions("probe");
      else openSettings();
    },
  };
}
