import type { DashboardAgentCard } from "./dashboard";
import type { AgentStatus } from "./ranking";

export type RuntimeAgentStatuses = Record<string, AgentStatus>;
export type SeenCompletions = Record<string, true | string>;

export function runtimeAgentStatuses(agents: DashboardAgentCard[]): RuntimeAgentStatuses {
  return Object.fromEntries(agents.map((agent) => [agent.paneId, agent.status]));
}

function hasRichIdentity(agent: DashboardAgentCard): boolean {
  return Boolean(agent.runtimeSession || agent.terminalId || agent.agentInstanceId || agent.stateChangeSeq !== undefined);
}

export function completionToken(agent: DashboardAgentCard): true | string {
  if (!hasRichIdentity(agent)) return true;
  return JSON.stringify([
    agent.runtimeSession || "",
    agent.terminalId || "",
    agent.agentInstanceId || "",
    agent.stateChangeSeq ?? null,
  ]);
}

function acknowledgementMatches(agent: DashboardAgentCard, value: true | string | undefined): boolean {
  return value !== undefined && value === completionToken(agent);
}

/** Keep an acknowledgement only while the same runtime completion is current. */
export function reconcileSeenCompletions(
  previous: RuntimeAgentStatuses,
  next: RuntimeAgentStatuses,
  current: SeenCompletions,
  agents?: DashboardAgentCard[],
): SeenCompletions {
  const byPane = new Map((agents || []).map((agent) => [agent.paneId, agent]));
  const seen: SeenCompletions = Object.create(null);
  for (const [paneId, status] of Object.entries(next)) {
    if (status !== "done") continue;
    const before = Object.hasOwn(previous, paneId) ? previous[paneId] : undefined;
    if (before !== undefined && before !== "done") continue;
    const acknowledged = current[paneId];
    const agent = byPane.get(paneId);
    if (agent ? acknowledgementMatches(agent, acknowledged) : acknowledged !== undefined) {
      seen[paneId] = acknowledged!;
    }
  }
  const keys = Object.keys(seen);
  const currentKeys = Object.keys(current);
  if (keys.length === currentKeys.length && keys.every((paneId) => seen[paneId] === current[paneId])) return current;
  return seen;
}

export function applySeenCompletions(agents: DashboardAgentCard[], seen: SeenCompletions): DashboardAgentCard[] {
  let changed = false;
  const displayed = agents.map((agent) => {
    if (agent.status !== "done" || !acknowledgementMatches(agent, seen[agent.paneId])) return agent;
    changed = true;
    return { ...agent, status: "idle" as const };
  });
  return changed ? displayed : agents;
}

export function projectCompletionAttention(
  rawAgents: DashboardAgentCard[],
  previous: RuntimeAgentStatuses,
  current: SeenCompletions,
): { agents: DashboardAgentCard[]; runtimeStatuses: RuntimeAgentStatuses; seen: SeenCompletions } {
  const runtimeStatuses = runtimeAgentStatuses(rawAgents);
  const seen = reconcileSeenCompletions(previous, runtimeStatuses, current, rawAgents);
  return { agents: applySeenCompletions(rawAgents, seen), runtimeStatuses, seen };
}

export function markCompletionSeen(
  current: SeenCompletions,
  runtimeStatuses: RuntimeAgentStatuses,
  paneId: string,
  agents?: DashboardAgentCard[],
): SeenCompletions {
  if (runtimeStatuses[paneId] !== "done") return current;
  const agent = agents?.find((item) => item.paneId === paneId);
  const token = agent ? completionToken(agent) : true;
  if (current[paneId] === token) return current;
  return { ...current, [paneId]: token };
}

/** A successful submit re-arms completion even if a fast turn hides working. */
export function rearmCompletion(current: SeenCompletions, paneId: string): SeenCompletions {
  if (!Object.hasOwn(current, paneId)) return current;
  const next = { ...current };
  delete next[paneId];
  return next;
}

export function projectAgentSubmission(
  agents: DashboardAgentCard[],
  runtimeStatuses: RuntimeAgentStatuses,
  seen: SeenCompletions,
  paneId: string,
): { agents: DashboardAgentCard[]; runtimeStatuses: RuntimeAgentStatuses; seen: SeenCompletions } {
  const target = agents.find((agent) => agent.paneId === paneId);
  if (!target?.hasAgent) return { agents, runtimeStatuses, seen };
  return {
    agents: agents.map((agent) => agent.paneId === paneId ? { ...agent, status: "working" as const } : agent),
    runtimeStatuses: { ...runtimeStatuses, [paneId]: "working" },
    seen: rearmCompletion(seen, paneId),
  };
}

export function parseSeenCompletions(raw: string | null, limit = 512): SeenCompletions {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const seen: SeenCompletions = Object.create(null);
    let count = 0;
    for (const [paneId, acknowledged] of Object.entries(value as Record<string, unknown>)) {
      if (count >= limit) break;
      const validToken = acknowledged === true || (typeof acknowledged === "string" && acknowledged.length > 0 && acknowledged.length <= 1024);
      if (validToken && paneId.length > 0 && paneId.length <= 256) {
        seen[paneId] = acknowledged as true | string;
        count++;
      }
    }
    return seen;
  } catch {
    return {};
  }
}
