import { expect, test } from "bun:test";
import type { AgentCard } from "../../../lib/ranking";
import { createPromptProgress, observedPromptActivity, promptProgressMessage } from "./prompt-progress";
const agent: AgentCard = { paneId: "p", agent: "codex", status: "idle", workspaceLabel: "", cwd: "/repo", terminalId: "terminal", agentInstanceId: "occupant", stateChangeSeq: 4 };
test("accepted input does not claim processing or completion", () => {
  const start = createPromptProgress(agent, 100);
  expect(promptProgressMessage(start, agent, 100)).toBe("promptProgress.sending");
  const accepted = { ...start, phase: "submitted" as const };
  expect(promptProgressMessage(accepted, agent, 101)).toBe("promptProgress.submitted");
  expect(promptProgressMessage(accepted, { ...agent, status: "done", stateChangeSeq: 5 }, 8100)).toBe("promptProgress.stalled");
  expect(promptProgressMessage(accepted, { ...agent, status: "working", stateChangeSeq: 5 }, 101)).toBe("promptProgress.processing");
  expect(observedPromptActivity(accepted, { ...agent, status: "working", stateChangeSeq: 4 })).toBe(false);
});
test("existing work, launch activity and a replaced occupant cannot confirm this prompt", () => {
  const accepted = { ...createPromptProgress({ ...agent, status: "working" }, 100), phase: "submitted" as const };
  expect(promptProgressMessage(accepted, { ...agent, status: "done", stateChangeSeq: 8 }, 9000)).toBe("promptProgress.busy");
  expect(observedPromptActivity(accepted, { ...agent, status: "working", stateChangeSeq: 9 })).toBe(false);
  const idle = { ...accepted, baselineStatus: "idle" as const };
  expect(observedPromptActivity(idle, { ...agent, status: "working", stateChangeSeq: 5, launchPending: true })).toBe(false);
  expect(promptProgressMessage(idle, { ...agent, agentInstanceId: "other" }, 9000)).toBeNull();
});
test("blocked, transcript receipt and uncertain delivery have distinct feedback", () => {
  const accepted = { ...createPromptProgress(agent, 100), phase: "submitted" as const };
  expect(promptProgressMessage(accepted, { ...agent, status: "blocked" }, 100)).toBe("promptProgress.blocked");
  expect(promptProgressMessage({ ...accepted, phase: "recorded" }, agent, 100)).toBe("promptProgress.recorded");
  expect(promptProgressMessage({ ...accepted, phase: "unknown" }, agent, 100)).toBe("promptProgress.unknown");
});
