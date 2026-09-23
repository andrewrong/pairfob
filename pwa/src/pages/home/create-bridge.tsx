/**
 * Create bridge.
 *
 * Every "new" entry — the floating button, a workspace heading's +, the board's
 * "+ tab", a workspace menu and the empty list — opens the same create sheet.
 * This file gathers what the sheet needs from the domains when the entry is
 * pressed, and turns the reader's answer into the existing mutation, so the
 * operation owner, busy marker and "open the new pane" behavior stay the ones
 * the controller already runs. Each mutation carries its own operation id and
 * is never retried here.
 */
import { Plus } from "lucide-react";
import { capabilityEnabled, advertisedAgentKinds } from "../../features/operations/capabilities-store";
import { computersStore, liveSession } from "../../features/computers/catalog-store";
import { liveAgents, selectedAgent } from "../../features/dashboard/catalog-store";
import { runtimeStore } from "../../features/connection/runtime-store";
import { boardStore } from "../../features/board/layout-store";
import { createSelectedTab, createWorktreeFrom, startNewConversation } from "../../features/operations/controller";
import { loadCreateMemory, rememberCreate } from "../../features/operations/create-memory";
import { askCreate, NEW_WORKSPACE, type CreateRequest, type CreateWorkspaceOption } from "../../features/operations/create-sheet";
import { loadLastAgentKind } from "../../features/operations/operation-form-model";
import { computerTitle } from "../../lib/computer-catalog";
import type { DashboardAgentCard } from "../../lib/dashboard";
import { t } from "../../lib/i18n";
import { MenuChoice, showActionSheet } from "../../shared/ui/overlay";
import { AgentAvatar } from "../../shared/ui/primitives";
import { currentScreen } from "../../app/navigation-store";

type Anchors = Map<string, DashboardAgentCard>;

/** One anchor pane per workspace, in the computer's order, the context first. */
function workspaceChoices(first: string | undefined): { options: CreateWorkspaceOption[]; anchors: Anchors } {
  const anchors: Anchors = new Map();
  for (const agent of liveAgents() as DashboardAgentCard[]) {
    if (agent.workspaceId && !anchors.has(agent.workspaceId)) anchors.set(agent.workspaceId, agent);
  }
  const ids = [...anchors.keys()];
  const ordered = first && anchors.has(first) ? [first, ...ids.filter((id) => id !== first)] : ids;
  return {
    anchors,
    options: ordered.map((id) => {
      const agent = anchors.get(id)!;
      return { id, label: agent.workspaceLabel || t("workspace.unnamed"), path: agent.workspaceCwd || "" };
    }),
  };
}

/** The workspace the reader is looking at: the board's, else the open pane's. */
function contextWorkspace(): string | undefined {
  if (currentScreen() === "board") return boardStore.get().boardWorkspaceId || undefined;
  return selectedAgent()?.workspaceId || undefined;
}

function hostName(): string {
  const pair = computersStore.get().credential;
  return runtimeStore.get().herdHost || (pair ? computerTitle(pair) : "") || t("settings.currentComputer");
}

function run(request: CreateRequest, anchors: Anchors): void {
  if (request.kind === "tab") {
    const anchor = anchors.get(request.workspaceId);
    if (!anchor) return;
    rememberCreate({ kind: request.agentKind, workspaceId: request.workspaceId });
    void createSelectedTab(anchor, {
      ...(request.agentKind ? { agent_kind: request.agentKind } : {}),
      ...(request.label ? { label: request.label } : {}),
    });
  } else if (request.kind === "conversation") {
    rememberCreate({ kind: request.agentKind, cwd: request.cwd });
    void startNewConversation({
      cwd: request.cwd,
      ...(request.agentKind ? { agent_kind: request.agentKind } : {}),
      ...(request.label ? { label: request.label } : {}),
    });
  } else {
    rememberCreate({ kind: "", cwd: request.cwd });
    createWorktreeFrom({
      cwd: request.cwd,
      ...(request.branch ? { branch: request.branch } : {}),
      ...(request.base ? { base: request.base } : {}),
      ...(request.label ? { label: request.label } : {}),
    });
  }
}

/** Open the create sheet; `workspaceId` preselects it, `newWorkspace` starts on a new one. */
export async function openCreateSheet(options: { workspaceId?: string; newWorkspace?: boolean } = {}): Promise<void> {
  if (liveSession()?.isConnected() !== true) return;
  const canCreateTab = capabilityEnabled("create_tab");
  const canCreateWorkspace = capabilityEnabled("create_conversation");
  if (!canCreateTab && !canCreateWorkspace) return;
  const { options: workspaces, anchors } = workspaceChoices(options.workspaceId ?? contextWorkspace());
  const kinds = [...advertisedAgentKinds()];
  const request = await askCreate({
    host: hostName(),
    workspaces,
    initial: options.newWorkspace || !workspaces.length ? NEW_WORKSPACE : workspaces[0].id,
    kinds,
    memory: loadCreateMemory(),
    lastKind: loadLastAgentKind(kinds),
    canCreateTab,
    canCreateWorkspace,
    canCreateWorktree: capabilityEnabled("create_worktree"),
  });
  // The sheet may have been open across a disconnect or a computer switch.
  if (!request || liveSession()?.isConnected() !== true) return;
  run(request, anchors);
}

/**
 * A hold on the create button: the last few "kind in workspace" combinations,
 * each created in one step, plus the full sheet.
 */
export function openQuickCreate(): void {
  if (liveSession()?.isConnected() !== true) return;
  if (!capabilityEnabled("create_tab")) {
    void openCreateSheet();
    return;
  }
  const kinds = advertisedAgentKinds();
  const { options, anchors } = workspaceChoices(undefined);
  const combos = loadCreateMemory().recents.filter((combo) =>
    anchors.has(combo.workspaceId) && (combo.kind === "" || kinds.includes(combo.kind)));
  if (!combos.length) {
    void openCreateSheet();
    return;
  }
  showActionSheet(t("create.quickTitle"), (modal) => (
    <>
      {combos.map((combo) => {
        const space = options.find((item) => item.id === combo.workspaceId)!;
        return (
          <MenuChoice key={`${combo.kind}@${combo.workspaceId}`} modal={modal}
            icon={<AgentAvatar kind={combo.kind} size="sm" />}
            title={combo.kind || t("create.terminal")} detail={space.label}
            action={() => run({ kind: "tab", workspaceId: combo.workspaceId, agentKind: combo.kind, label: "" }, anchors)} />
        );
      })}
      <MenuChoice modal={modal} icon={<Plus size={18} aria-hidden="true" />} title={t("create.quickMore")}
        action={() => openCreateSheet()} />
    </>
  ));
}
