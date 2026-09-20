import type { DashboardAgentCard } from "../../lib/dashboard";

export type AttentionFilter = "all" | "needs-you" | "finished" | "running" | "checking";
export type AttentionCounts = Record<AttentionFilter, number>;

export function matchesAttentionFilter(agent: DashboardAgentCard, filter: AttentionFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs-you") return agent.status === "blocked";
  if (filter === "finished") return agent.status === "done";
  if (filter === "running") {
    return agent.status !== "blocked" && agent.status !== "done"
      && (agent.status === "working" || agent.launchPending === true);
  }
  return agent.hasAgent && agent.status !== "blocked" && agent.status !== "working" && agent.status !== "done"
    && !agent.launchPending && (agent.status === "unknown" || agent.interactiveReady === false);
}

export function attentionCounts(agents: readonly DashboardAgentCard[]): AttentionCounts {
  return {
    all: agents.length,
    "needs-you": agents.filter((agent) => matchesAttentionFilter(agent, "needs-you")).length,
    finished: agents.filter((agent) => matchesAttentionFilter(agent, "finished")).length,
    running: agents.filter((agent) => matchesAttentionFilter(agent, "running")).length,
    checking: agents.filter((agent) => matchesAttentionFilter(agent, "checking")).length,
  };
}

/** Preserve the existing deterministic rank when rich completion sequence is absent or tied. */
export function orderFinished<T extends DashboardAgentCard>(agents: readonly T[]): T[] {
  return agents.map((agent, index) => ({ agent, index })).sort((left, right) => {
    const sequence = (right.agent.stateChangeSeq ?? -1) - (left.agent.stateChangeSeq ?? -1);
    return sequence || left.index - right.index;
  }).map(({ agent }) => agent);
}
