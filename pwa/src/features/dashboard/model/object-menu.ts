/**
 * Herd object menu model.
 *
 * Pure projection of one card (or one workspace heading) into the sheet the
 * reader gets: the fact rows above the list and the ordered actions with their
 * labels, danger flags and gates. Which operations those actions perform is the
 * caller's business; nothing here reads the record or mutates anything.
 */
import {
  agentDetailRows,
  agentTitle,
  tabIsSplit,
  visibleTabLabel,
  type AgentDetailRow,
} from "../../../lib/dashboard";
import { t } from "../../../lib/i18n";
import type { AgentCard, ListGroup } from "../../../lib/ranking";

export type ObjectMenuKind =
  | "pin"
  | "newTabBeside"
  | "openBoard"
  | "renamePane"
  | "closePane"
  | "renameTab"
  | "closeTab"
  | "renameWorkspace"
  | "closeWorkspace"
  | "newTabInWorkspace";

/** Which object an action belongs to; the sheet shows one object at a time. */
export type ObjectMenuScope = "pane" | "tab" | "workspace";

export type ObjectMenuItem = { kind: ObjectMenuKind; label: string; danger?: boolean; scope: ObjectMenuScope };

export type ObjectMenuModel = {
  title: string;
  /** Workspace › tab › session names for the pane menu; empty for a heading menu. */
  path: string[];
  facts: AgentDetailRow[];
  items: ObjectMenuItem[];
};

/**
 * The card menu, one object at a time: this session, its tab, its workspace.
 * A tab is only renamable/closable when it is named or split.
 */
export function paneMenuModel(input: {
  agent: AgentCard;
  agents: AgentCard[];
  listGroup: ListGroup;
  pinned: boolean;
  createTab: boolean;
}): ObjectMenuModel {
  const { agent, agents, listGroup } = input;
  const split = tabIsSplit(agent, agents);
  const items: ObjectMenuItem[] = [
    { kind: "pin", label: t(input.pinned ? "menu.unpin" : "menu.pin"), scope: "pane" },
    { kind: "renamePane", label: t("menu.renamePane"), scope: "pane" },
    { kind: "closePane", label: t("op.closePane"), danger: true, scope: "pane" },
  ];
  if (agent.workspaceId) items.push({ kind: "openBoard", label: t("menu.board"), scope: "tab" });
  if (visibleTabLabel(agent.tabLabel) || split) items.push({ kind: "renameTab", label: t("menu.renameTab"), scope: "tab" });
  if (split) items.push({ kind: "closeTab", label: t("op.closeTab"), danger: true, scope: "tab" });
  if (agent.workspaceId) {
    if (input.createTab) items.push({ kind: "newTabBeside", label: t("menu.newTabBeside"), scope: "workspace" });
    items.push({ kind: "renameWorkspace", label: t("menu.renameWorkspace"), scope: "workspace" });
    items.push({ kind: "closeWorkspace", label: t("op.closeWorkspace"), danger: true, scope: "workspace" });
  }
  return {
    // The sheet title is the card title the reader pressed.
    title: agentTitle(agent, listGroup),
    path: [agent.workspaceLabel?.trim() || "", visibleTabLabel(agent.tabLabel), agentTitle(agent, listGroup)].filter(Boolean),
    facts: agentDetailRows(agent, agents, listGroup),
    items,
  };
}

/** The workspace heading menu; null when the group has no real workspace. */
export function workspaceMenuModel(input: { agent: AgentCard; createTab: boolean }): ObjectMenuModel | null {
  const { agent } = input;
  if (!agent.workspaceId) return null;
  const items: ObjectMenuItem[] = [];
  if (input.createTab) items.push({ kind: "newTabInWorkspace", label: t("menu.newTabInWorkspace"), scope: "workspace" });
  items.push({ kind: "renameWorkspace", label: t("menu.renameWorkspace"), scope: "workspace" });
  items.push({ kind: "closeWorkspace", label: t("op.closeWorkspace"), danger: true, scope: "workspace" });
  return { title: agent.workspaceLabel || t("workspace.unnamed"), path: [], facts: [], items };
}
