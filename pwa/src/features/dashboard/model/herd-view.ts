/**
 * Dashboard (home herd list) view model.
 *
 * Pure projection: the builder takes an explicit input snapshot and returns
 * everything the herd screen renders — groups, cards, class lists, copy, gates
 * and the entrance/attention decoration. It never reads the global app state,
 * never touches the DOM, and never consumes attention memory: the caller
 * consumes attention once per paint and hands the resulting marks in.
 */
import { agentDisplaySummary } from "../../../lib/agent-inspect";
import { agentMeta, agentStatusLabel, agentTitle, cwdName, statusLabel, terminalMeta, type DashboardAgentCard } from "../../../lib/dashboard";
import type { HerdPaint, StatusMark } from "../../../lib/herd-attention";
import { t } from "../../../lib/i18n";
import {
  groupAgents,
  paneIsPinned,
  PINNED_GROUP_ID,
  type AgentCard,
  type AgentGroup,
  type ListGroup,
  type PinnedAt,
  type TouchedAt,
} from "../../../lib/ranking";
import type { RuntimeLiveness } from "../../../lib/runtime-liveness";
import { emptySessionCopy, type EmptySessionAction } from "../../../lib/ui-model";

/** Status tone vocabulary of the app chrome; core publishes the same union. */
export type HerdTone = "live" | "warn" | "off" | "demo" | "pending";

export type HerdStatus = { tone: HerdTone; text: string };

/** Option B header: the computer's name, and one line for how it is reached. */
export type HerdHostView = { name: string; line: string; tone: HerdTone };

export type HerdModelInput = {
  /** The published card list; a domain snapshot is read-only by contract. */
  agents: readonly DashboardAgentCard[];
  listGroup: ListGroup;
  paneTouched: TouchedAt;
  /** The reader's own opens: the list order. `paneTouched` only dates the rows. */
  paneActivated: TouchedAt;
  panePinned: PinnedAt;
  groupCollapsed: Record<string, boolean>;
  selectedPaneId: string;
  /** Attention consumed once by the paint boundary that built this input. */
  attention: HerdPaint;
  liveness: RuntimeLiveness;
  status: HerdStatus;
  connected: boolean;
  networkOnline: boolean;
  runtimeKind: string;
  createConversation: boolean;
  operationBusy: boolean;
  computerCount: number;
  /** Pane whose title currently shares the view-transition name, if any. */
  morphingPaneId: string | null;
  host: HerdHostView;
  createTab: boolean;
  /** Wall clock for the "changed n minutes ago" column. */
  now: number;
};

export type HerdCardView = {
  paneId: string;
  /** A plain shell reports no agent status; only agents carry a status word. */
  kind: "agent" | "terminal";
  agentKind: string;
  /** Status word for an agent row; empty for a terminal. */
  statusLabel: string;
  statusTone: AgentCard["status"];
  /** Second line: status-free facts (place, tab, task tokens). */
  line: string;
  /** Time since the phone last saw this pane change; empty when unknown. */
  ago: string;
  blocked: boolean;
  unread: boolean;
  /** The card the menu actions operate on; refreshed with every projection. */
  agent: DashboardAgentCard;
  className: string;
  index: number;
  title: string;
  meta: string;
  pill: { className: string; text: string } | null;
  pinned: boolean;
  pinnedLabel: string;
  selected: boolean;
  /** The pane the declared navigation is about; the transition names its row itself. */
  sharesTransition: boolean;
};

export type HerdGroupView = {
  id: string;
  title: string;
  count: number;
  index: number;
  collapsed: boolean;
  /** Only a workspace group with a real workspace id owns the heading menu. */
  hasMenu: boolean;
  menuAgent: AgentCard | undefined;
  /** Workspace root shown under a workspace heading. */
  path: string;
  /** Rows in this group waiting on the reader / finished and not yet read. */
  blockedCount: number;
  doneCount: number;
  /** The heading's + opens the create sheet on this workspace. */
  canCreateTab: boolean;
  cards: HerdCardView[];
};

export type HerdAttentionItem = {
  paneId: string;
  title: string;
  workspace: string;
  agentKind: string;
  kind: "blocked" | "done";
};

export type HerdEmptyView = {
  title: string;
  sub: string;
  action: { label: string; kind: EmptySessionAction; disabled: boolean } | null;
};

export type HerdViewModel = {
  groups: HerdGroupView[];
  /**
   * Displayed group order. The accordion fold belongs to the model a screen was
   * rendered from, so a toggle carries this instead of re-deriving it from
   * whatever the record holds when the click lands.
   */
  groupIds: string[];
  /** Grouped modes render an accordion; flat renders bare section titles. */
  grouped: boolean;
  /** Replay the card entrance because the list shape changed. */
  stagger: boolean;
  empty: HerdEmptyView | null;
  status: HerdStatus;
  host: HerdHostView;
  doneCount: number;
  pendingCount: number;
  /** "Needs you" strip: waiting first, then unread completions. */
  attention: HerdAttentionItem[];
  listGroup: ListGroup;
  create: { label: string; aria: string; disabled: boolean } | null;
  /** Desktop rail links; the phone reaches these through the tab bar. */
  computers: { label: string } | null;
  board: { label: string };
  settings: { label: string };
};

export function herdCardClassName(input: {
  status: AgentCard["status"];
  stale: boolean;
  selected: boolean;
  pinned: boolean;
  mark: StatusMark;
  dismissing: boolean;
}): string {
  const attention = (input.mark ? (input.mark === "done" ? " ac-changed ac-done" : " ac-changed") : "")
    + (input.dismissing ? " attn-out" : "");
  return `card status-${input.status}${input.stale ? " unverifiable" : ""}${input.selected ? " sel" : ""}`
    + `${input.pinned ? " pinned" : ""}${attention}`;
}

/** Loss of contact never claims a status: the known pill is replaced, not removed. */
export function herdCardPill(status: AgentCard["status"], stale: boolean): { className: string; text: string } | null {
  const text = stale ? t("status.unverifiable") : statusLabel(status);
  if (!text) return null;
  return { className: `pill pill-${stale ? "unknown" : status}`, text };
}

export function herdDoneCount(agents: readonly AgentCard[]): number {
  return agents.filter((agent) => agent.status === "done").length;
}

export function herdEmptyView(input: {
  runtimeKind: string;
  connected: boolean;
  createConversation: boolean;
  networkOnline: boolean;
  operationBusy: boolean;
}): HerdEmptyView {
  const copy = emptySessionCopy(input.runtimeKind, input.connected, input.createConversation, input.networkOnline);
  const action = copy.action ? emptyActionSpec(copy.action, input.operationBusy, input.connected) : null;
  return { title: copy.title, sub: copy.detail, action };
}

export function emptyActionSpec(
  kind: EmptySessionAction,
  operationBusy: boolean,
  connected: boolean,
): { label: string; kind: EmptySessionAction; disabled: boolean } {
  if (kind === "create") return { label: t("empty.actionCreate"), kind, disabled: operationBusy || !connected };
  if (kind === "retry") return { label: t("empty.actionRetry"), kind, disabled: false };
  return { label: t("empty.actionSettings"), kind, disabled: false };
}

/** Compact "changed n ago" copy; empty when the phone never saw a change. */
export function herdAgo(touched: number | undefined, now: number): string {
  if (!touched || touched <= 0) return "";
  const minutes = Math.floor(Math.max(0, now - touched) / 60_000);
  if (minutes < 1) return t("list.agoNow");
  if (minutes < 60) return t("list.agoMin", { n: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("list.agoHour", { n: String(hours) });
  return t("list.agoDay", { n: String(Math.floor(hours / 24)) });
}

/** An agent-bound pane that is waiting on the reader or finished unread. */
export function herdNeedsReader(agent: DashboardAgentCard): "blocked" | "done" | "" {
  if (!agent.hasAgent) return "";
  return agent.status === "blocked" ? "blocked" : agent.status === "done" ? "done" : "";
}

/**
 * Who a pane is and what it is doing, as the list card shows it. The session
 * header renders the same projection, so the title that travels between the two
 * during the shared transition is the same text on both ends.
 */
export type PaneIdentity = {
  kind: "agent" | "terminal";
  agentKind: string;
  title: string;
  /** Status word for an agent; empty for a plain terminal. */
  statusLabel: string;
  statusTone: AgentCard["status"];
  /** Status-free facts: the reported task, or agent · place · tab. */
  line: string;
  /** The facts without the task summary; the card's legacy meta column. */
  meta: string;
};

export function paneIdentity(agent: DashboardAgentCard, listGroup: ListGroup, stale: boolean): PaneIdentity {
  const isAgent = agent.hasAgent;
  const meta = isAgent ? agentMeta(agent, listGroup) : terminalMeta(agent, listGroup);
  return {
    kind: isAgent ? "agent" : "terminal",
    agentKind: agent.agent,
    title: agentTitle(agent, listGroup),
    statusLabel: isAgent ? (stale ? t("status.unverifiable") : agentStatusLabel(agent)) : "",
    statusTone: stale ? "unknown" : agent.status,
    line: agentDisplaySummary(agent) || meta,
    meta,
  };
}

/**
 * The header has no group heading above it, so it names the workspace (or the
 * directory) at the end of the card's line unless the line or title already
 * says it.
 */
export function paneHeaderLine(identity: PaneIdentity, agent: DashboardAgentCard): string {
  const place = agent.workspaceLabel?.trim() || cwdName(agent.cwd ?? "").trim();
  const parts = identity.line.split(" · ").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (!place || parts.includes(place.toLowerCase()) || identity.title.trim().toLowerCase() === place.toLowerCase()) {
    return identity.line;
  }
  return identity.line ? `${identity.line} · ${place}` : place;
}

/** Other panes waiting on the reader. Nothing is claimed while status cannot be confirmed. */
export function blockedElsewhere(agents: readonly DashboardAgentCard[], paneId: string, stale: boolean): number {
  if (stale) return 0;
  return agents.filter((agent) => agent.paneId !== paneId && herdNeedsReader(agent) === "blocked").length;
}

function cardView(
  agent: DashboardAgentCard,
  input: HerdModelInput,
  index: number,
  stale: boolean,
): HerdCardView {
  const pinned = paneIsPinned(input.panePinned, agent.paneId);
  const needs = stale ? "" : herdNeedsReader(agent);
  const identity = paneIdentity(agent, input.listGroup, stale);
  return {
    paneId: agent.paneId,
    kind: identity.kind,
    agentKind: identity.agentKind,
    statusLabel: identity.statusLabel,
    statusTone: identity.statusTone,
    line: identity.line,
    ago: herdAgo(input.paneTouched[agent.paneId], input.now),
    blocked: needs === "blocked",
    unread: needs === "done",
    agent,
    className: herdCardClassName({
      status: agent.status,
      stale,
      selected: agent.paneId === input.selectedPaneId,
      pinned,
      mark: input.attention.markOf(agent.paneId),
      dismissing: input.attention.isDismissing(agent.paneId),
    }),
    index,
    title: identity.title,
    meta: identity.meta,
    pill: stale
      ? herdCardPill(agent.status, true)
      : { className: `pill pill-${agent.status}`, text: agentStatusLabel(agent) },
    pinned,
    pinnedLabel: t("home.pinned"),
    selected: agent.paneId === input.selectedPaneId,
    sharesTransition: input.morphingPaneId === agent.paneId,
  };
}

/** The heading menu belongs to the first item that really has a workspace. */
export function groupMenuAgent(group: AgentGroup): AgentCard | undefined {
  return group.items.find((item) => item.workspaceId) ?? group.items[0];
}

export function groupHasMenu(listGroup: ListGroup, group: AgentGroup): boolean {
  return listGroup === "space" && group.id !== PINNED_GROUP_ID && Boolean(groupMenuAgent(group)?.workspaceId);
}

/**
 * Project the herd list. Group order, ranking, accordion defaults and the
 * stagger index sequence all come out of one pass so the screen renders exactly
 * what the model says.
 */
export function buildHerdViewModel(input: HerdModelInput): HerdViewModel {
  const groups = groupAgents([...input.agents], input.listGroup, input.paneActivated, input.panePinned);
  const stale = input.liveness === "unverifiable";
  const grouped = input.listGroup !== "flat";
  const richAgents = new Map(input.agents.map((agent) => [agent.paneId, agent]));
  let position = 0;
  const views = groups.map((group) => {
    const index = position;
    position += group.items.length + 1;
    const cards = group.items.map((agent, offset) => cardView(richAgents.get(agent.paneId)!, input, index + offset + 1, stale));
    const hasMenu = groupHasMenu(input.listGroup, group);
    const menuAgent = groupMenuAgent(group);
    return {
      id: group.id,
      title: group.title,
      count: group.items.length,
      index,
      collapsed: grouped && input.groupCollapsed[group.id] === true,
      hasMenu,
      menuAgent,
      path: hasMenu ? (menuAgent?.workspaceCwd || "") : "",
      blockedCount: cards.filter((card) => card.blocked).length,
      doneCount: cards.filter((card) => card.unread).length,
      canCreateTab: hasMenu && input.createTab,
      cards,
    };
  });
  const attention: HerdAttentionItem[] = stale ? [] : input.agents
    .map((agent) => ({ agent, kind: herdNeedsReader(agent) }))
    .filter((item): item is { agent: DashboardAgentCard; kind: "blocked" | "done" } => item.kind !== "")
    .sort((left, right) => Number(left.kind === "done") - Number(right.kind === "done")
      || (input.paneTouched[right.agent.paneId] ?? 0) - (input.paneTouched[left.agent.paneId] ?? 0))
    .map(({ agent, kind }) => ({
      paneId: agent.paneId,
      title: agentTitle(agent, "flat"),
      workspace: agent.workspaceLabel || "",
      agentKind: agent.agent,
      kind,
    }));
  return {
    groups: views,
    groupIds: views.map((group) => group.id),
    grouped,
    stagger: input.attention.stagger,
    empty: input.agents.length ? null : herdEmptyView(input),
    status: input.status,
    host: input.host,
    attention,
    listGroup: input.listGroup,
    doneCount: attention.filter((item) => item.kind === "done").length,
    pendingCount: attention.filter((item) => item.kind === "blocked").length,
    create: input.createConversation
      ? {
          label: input.operationBusy ? t("home.creating") : t("home.new"),
          aria: t("home.newAria"),
          disabled: input.operationBusy || !input.connected,
        }
      : null,
    computers: input.computerCount > 1 ? { label: t("home.computers") } : null,
    board: { label: t("home.board") },
    settings: { label: t("home.settings") },
  };
}
