import { expect, test } from "bun:test";
import { displayTokens, parseAgentInspection } from "./agent-inspect";
import { mapSnapshotAgents } from "./dashboard";

test("display metadata cannot change semantic status and disappears when absent", () => {
  const snapshot = { workspaces: [{ workspace_id: "w", tokens: { task: "project" }, worktree: { repo_name: "repo", checkout_path: "/repo/branch", is_linked_worktree: true } }],
    panes: [{ pane_id: "p", workspace_id: "w", agent: "codex", agent_status: "working", display_agent: "Reviewer", state_labels: { working: "Completed!" }, tokens: { task: "Review" } }] };
  const card = mapSnapshotAgents(snapshot)[0];
  expect(card.status).toBe("working"); expect(card.agent).toBe("codex");
  expect(card.displayAgent).toBe("Reviewer"); expect(card.worktree?.repo_name).toBe("repo");
  expect(card.workspaceTokens?.task).toBe("project");
  expect(mapSnapshotAgents({ panes: [{ pane_id: "p", workspace_id: "w", agent: "codex" }] })[0].tokens).toBeUndefined();
});
test("metadata is bounded, display only and text safe", () => {
  const labels = displayTokens({ idle: "Ready\u202e\u0000", nope: "not a state" }, true);
  expect(labels).toEqual({ idle: "Ready" });
  const tokens = displayTokens(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`key${i}`, "界".repeat(300)])))!;
  expect(Object.keys(tokens)).toHaveLength(32); expect([...Object.values(tokens)[0]]).toHaveLength(256);
});
test("diagnostic parser rejects invalid and oversized payloads and unknown fields", () => {
  const base = { status: "idle", screen_detection_skipped: false, rules: [] };
  expect(() => parseAgentInspection({ ...base, raw_screen: "private" })).toThrow();
  for (const payload of [{ ...base, status: "success" }, { ...base, rules: [{ id: "a", state: "working", matched: "yes" }] },
    { ...base, warning: "x".repeat(257) }, { ...base, rules: Array(33).fill({ id: "a", state: "idle", matched: false }) }]) {
    expect(() => parseAgentInspection(payload)).toThrow();
  }
});

test("older config without the new capability stays usable", async () => {
  const { NO_OPERATION_CAPABILITIES, parseRuntimeOperationsConfig } = await import("./operations");
  const { agent_inspect: _, ...legacy } = NO_OPERATION_CAPABILITIES;
  const config = { protocol: 1, build: "test", daemon_id: "daemon", hostname: "host", runtime: "herdr", vapid_public: "",
    submit_keys: ["Enter"], idle_pause_ms: 100, push_delivery: "webpush", push_enabled: false, agent_kinds: [], capabilities: legacy };
  expect(parseRuntimeOperationsConfig(config).capabilities.agent_inspect).toBe(false);
  expect(() => parseRuntimeOperationsConfig({ ...config, capabilities: { ...legacy, agent_inspect: "true" } })).toThrow();
});
