import { Columns2, Copy, GitBranch, Info, LayoutGrid, Pencil, Plus, RotateCw, TextCursorInput, Trash2 } from "lucide-react";
import { AgentInformation } from "./agent-information";
import { PaneQuickSettings } from "./pane-menu-settings";
import { NewTabPage, SplitPage, WorktreePage } from "./pane-menu-pages";
import { PaneLayoutPage } from "./pane-layout-page";
import { operationCapabilities, advertisedAgentKinds } from "../../operations/capabilities-store";
import { liveSession } from "../../computers/catalog-store";
import { selectedAgent } from "../../dashboard/catalog-store";
import { isAgentChat, isFullTerminal, openPaneId } from "../session-store";
import { paneTermMode } from "../../settings/preferences-store";
import { agentTitle } from "../../../lib/dashboard";
import { t } from "../../../lib/i18n";
import type { DashboardAgentCard as AgentCard } from "../../../lib/dashboard";
import { closePane, copyScreenText, layoutSelectedPane, renamePane } from "../../../features/operations/controller";
import { retryFullTerminal } from "../full-terminal/full-terminal";
import { toggleTermSelect } from "./term";
import { showActionSheet, type ActionSheetController } from "../../../shared/ui/overlay/action-sheet";
import { MenuGroup, MenuRow, MenuTile, MenuTiles } from "../../../shared/ui/overlay/menu-controls";
import { useSheetNav } from "../../../shared/ui/overlay/sheet-stack";

export function fillSelectedPane(): void { void layoutSelectedPane("zoom"); }

type MenuContext = { modal: ActionSheetController; agent: AgentCard | undefined; full: boolean; chat: boolean };

/**
 * The pane sheet, by weight: quick settings that apply in place, a row of
 * frequent actions, pages for layout / Worktree / details, and the one
 * destructive action on its own at the end.
 */
function PaneMenu({ modal, agent, full, chat }: MenuContext) {
  const nav = useSheetNav()!;
  const caps = operationCapabilities();
  const kinds = [...advertisedAgentKinds()];
  const worktrees = caps.list_worktrees || caps.create_worktree || caps.open_worktree;
  const session = liveSession();
  return <>
    <PaneQuickSettings modal={modal} mode={paneTermMode(openPaneId())} full={full} chat={chat} />
    <MenuTiles>
      {!chat && <MenuTile modal={modal} action={copyScreenText} icon={<Copy size={22} />} label={t("pane.tileCopy")} aria={t("menu.copyScreen")} />}
      {!chat && <MenuTile modal={modal} action={() => toggleTermSelect(true)} icon={<TextCursorInput size={22} />}
        label={t("pane.tileSelect")} aria={t("menu.selectText")} />}
      {caps.create_tab && agent && <MenuTile icon={<Plus size={22} />} label={t("pane.tileNewTab")} aria={t("menu.newTab")}
        onClick={() => nav.push({ key: "tab", title: t("form.newTab"), render: () => <NewTabPage modal={modal} agent={agent} agentKinds={kinds} /> })} />}
      {caps.split_pane && agent && <MenuTile icon={<Columns2 size={22} />} label={t("pane.tileSplit")} aria={t("menu.split")}
        onClick={() => nav.push({ key: "split", title: t("form.split"), render: () => <SplitPage modal={modal} agent={agent} agentKinds={kinds} /> })} />}
    </MenuTiles>
    <MenuGroup>
      {full && <MenuRow icon={<RotateCw size={18} />} label={t("pane.reconnect")} modal={modal} action={retryFullTerminal} />}
      {agent && <MenuRow icon={<LayoutGrid size={18} />} label={t("pane.layoutPage")} next
        onClick={() => nav.push({ key: "layout", title: t("pane.layoutPage"), render: () => <PaneLayoutPage modal={modal} agent={agent} /> })} />}
      {worktrees && <MenuRow icon={<GitBranch size={18} />} label={t("menu.worktree")} next
        onClick={() => nav.push({ key: "worktree", title: t("menu.worktree"), render: () => <WorktreePage modal={modal} caps={caps} /> })} />}
      {agent && session && <MenuRow icon={<Info size={18} />} label={t("agentInfo.title")} next
        onClick={() => nav.push({ key: "info", title: t("agentInfo.title"), render: () => <AgentInformation agent={agent} session={session} /> })} />}
      <MenuRow icon={<Pencil size={18} />} label={t("menu.renamePane")} modal={modal} action={renamePane} />
    </MenuGroup>
    <MenuGroup className="menu-danger-zone">
      <MenuRow icon={<Trash2 size={18} />} label={t("op.closePane")} modal={modal} action={closePane} danger />
    </MenuGroup>
  </>;
}

export function openPaneMenu(): void {
  const agent = selectedAgent();
  const full = isFullTerminal();
  const chat = isAgentChat();
  showActionSheet(t("pane.menuTitle"), modal => <PaneMenu modal={modal} agent={agent} full={full} chat={chat} />,
    { subtitle: agent ? agentTitle(agent) : undefined, expandable: true, className: "pane-menu-sheet" });
}
