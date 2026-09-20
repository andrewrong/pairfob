import { describe, expect, test } from "bun:test";
import type { DashboardAgentCard } from "../../lib/dashboard";
import { attentionCounts, matchesAttentionFilter, orderFinished } from "./attention-filter";

function card(paneId: string, status: DashboardAgentCard["status"], rich: Partial<DashboardAgentCard> = {}): DashboardAgentCard {
  return { paneId, status, hasAgent: true, agent: "pi", workspaceLabel: "repo", cwd: "/repo", ...rich };
}

describe("dashboard attention filters", () => {
  test("counts the five disjoint attention views from rich and legacy facts", () => {
    const agents = [
      card("blocked", "blocked"), card("done", "done"), card("working", "working"),
      card("starting", "idle", { launchPending: true }),
      card("not-ready", "idle", { interactiveReady: false }), card("unknown", "unknown"),
      card("shell", "idle", { hasAgent: false }), card("legacy", "idle"),
    ];
    expect(attentionCounts(agents)).toEqual({ all: 8, "needs-you": 1, finished: 1, running: 2, checking: 2 });
    expect(matchesAttentionFilter(agents[6]!, "checking")).toBe(false);
    expect(matchesAttentionFilter(agents[7]!, "checking")).toBe(false);
  });

  test("blocked and done override launch facts", () => {
    expect(matchesAttentionFilter(card("b", "blocked", { launchPending: true }), "running")).toBe(false);
    expect(matchesAttentionFilter(card("d", "done", { launchPending: true }), "running")).toBe(false);
  });

  test("finished uses newest sequence and a stable legacy fallback", () => {
    const ordered = orderFinished([
      card("legacy-a", "done"), card("new", "done", { stateChangeSeq: 9 }),
      card("legacy-b", "done"), card("older", "done", { stateChangeSeq: 3 }),
    ]);
    expect(ordered.map((agent) => agent.paneId)).toEqual(["new", "older", "legacy-a", "legacy-b"]);
  });
});
