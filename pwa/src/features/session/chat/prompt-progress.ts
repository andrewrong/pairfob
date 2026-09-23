import { agentObservationKey } from "../../../lib/agent-inspect";
import type { AgentCard } from "../../../lib/ranking";

import type { PromptProgress } from "./trace-store";
export type { PromptProgress, PromptProgressPhase } from "./trace-store";

export function createPromptProgress(agent: AgentCard, now = Date.now()): PromptProgress {
  return { owner: agentObservationKey(agent), startedAt: now, phase: "sending", baselineStatus: agent.status, baselineSeq: agent.stateChangeSeq };
}
export function promptProgressMessage(progress: Readonly<PromptProgress> | null, agent: AgentCard | undefined, now: number) {
  if (!progress || !agent || agentObservationKey(agent) !== progress.owner) return null;
  if (progress.phase === "sending") return "promptProgress.sending" as const;
  if (agent.status === "blocked") return "promptProgress.blocked" as const;
  if (progress.phase === "unknown") return "promptProgress.unknown" as const;
  if (progress.phase === "recorded") return "promptProgress.recorded" as const;
  if (progress.phase === "processing") return "promptProgress.processing" as const;
  // An already-running turn must never confirm that a newly submitted input began.
  if (progress.baselineStatus === "working") return "promptProgress.busy" as const;
  if (observedPromptActivity(progress, agent)) return "promptProgress.processing" as const;
  if (now - progress.startedAt >= 8000) return "promptProgress.stalled" as const;
  return "promptProgress.submitted" as const;
}
export function observedPromptActivity(progress: Readonly<PromptProgress>, agent: AgentCard): boolean {
  return agentObservationKey(agent) === progress.owner && progress.baselineStatus !== "working" && agent.status === "working"
    && agent.launchPending !== true && (progress.baselineSeq === undefined || agent.stateChangeSeq !== undefined && agent.stateChangeSeq > progress.baselineSeq);
}
