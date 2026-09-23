/**
 * Home layout view model.
 *
 * Pure projection of the board catalog into what the home "layout" view draws:
 * one section per workspace, one thumbnail per tab, and each pane as a fraction
 * of its tab's real split. Geometry is normalized to 0..1 so the thumbnail can
 * be any size; nothing here reads the DOM or an application record.
 */
import { agentStatusLabel, agentTitle, visibleTabLabel, type DashboardAgentCard } from "../../../lib/dashboard";
import { t } from "../../../lib/i18n";
import {
  layoutForTab,
  tabsInWorkspace,
  workspaceChipLabel,
  type BoardSpace,
  type BoardTab,
  type TabLayout,
} from "../../../lib/layout";

export type HerdLayoutInput = {
  workspaces: readonly BoardSpace[];
  tabs: readonly BoardTab[];
  layouts: readonly TabLayout[];
  agents: readonly DashboardAgentCard[];
  stale: boolean;
  canCreateTab: boolean;
};

export type HerdLayoutPane = {
  paneId: string;
  title: string;
  status: DashboardAgentCard["status"] | "unknown";
  statusText: string;
  /** Fractions of the tab area: left, top, width, height. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type HerdLayoutTab = {
  tabId: string;
  label: string;
  paneCount: number;
  zoomed: boolean;
  panes: HerdLayoutPane[];
};

export type HerdLayoutSection = {
  workspaceId: string;
  title: string;
  /** Anchors the workspace menu and "new tab here". */
  anchor: DashboardAgentCard | undefined;
  tabs: HerdLayoutTab[];
  canCreateTab: boolean;
};

function tabLabel(tab: BoardTab, index: number): string {
  const named = visibleTabLabel(tab.label);
  if (named && !/^\d{1,3}$/.test(named)) return named;
  return t("board.tabIndex", { n: index + 1 });
}

function panesOf(layout: TabLayout | null, agents: DashboardAgentCard[], stale: boolean): HerdLayoutPane[] {
  if (!layout || layout.area.width <= 0 || layout.area.height <= 0) return [];
  const { area } = layout;
  // A pane zoomed on the computer fills the whole tab there, so it does here too.
  const shown = layout.zoomed
    ? layout.panes.filter((pane) => pane.paneId === layout.focusedPaneId || pane.focused).slice(0, 1)
    : layout.panes;
  return shown.map((pane) => {
    const agent = agents.find((item) => item.paneId === pane.paneId);
    const whole = layout.zoomed;
    return {
      paneId: pane.paneId,
      title: agent ? agentTitle(agent) : pane.paneId,
      status: stale ? "unknown" : agent?.status ?? "idle",
      statusText: stale ? t("status.unverifiable") : agent ? agentStatusLabel(agent) : "",
      x: whole ? 0 : (pane.rect.x - area.x) / area.width,
      y: whole ? 0 : (pane.rect.y - area.y) / area.height,
      w: whole ? 1 : pane.rect.width / area.width,
      h: whole ? 1 : pane.rect.height / area.height,
    };
  });
}

export function buildHerdLayout(input: HerdLayoutInput): HerdLayoutSection[] {
  const agents = [...input.agents];
  const spaces = [...input.workspaces];
  const layouts = [...input.layouts] as TabLayout[];
  return spaces.map((space) => {
    const tabs = tabsInWorkspace([...input.tabs], space.id).map((tab, index) => {
      const layout = layoutForTab(tab.id, layouts, agents);
      const panes = panesOf(layout, agents, input.stale);
      return {
        tabId: tab.id,
        label: tabLabel(tab, index),
        paneCount: layout?.panes.length ?? panes.length,
        zoomed: layout?.zoomed === true,
        panes,
      };
    });
    return {
      workspaceId: space.id,
      title: workspaceChipLabel(space, spaces, agents, t("workspace.unnamed")),
      anchor: agents.find((agent) => agent.workspaceId === space.id),
      tabs,
      canCreateTab: input.canCreateTab,
    };
  }).filter((section) => section.tabs.length > 0);
}
