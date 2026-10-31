import { happy, resetTestDOM } from "../../../../test-support/boot-dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { resetComposeDrafts } from "../drafts/compose-drafts";
import { clearAgentTraceCache } from "../../../lib/agent-trace-cache";
import { setLang } from "../../../lib/i18n";
import type { LiveSession } from "../../../lib/protocol/client";
import { NO_OPERATION_CAPABILITIES, type AgentTraceItem, type AgentTracePage } from "../../../lib/operations";
import { applyTrace, chatSnapshot, setTraceLoadState } from "./trace-store";
import { leaveAgentChat, refreshAgentTrace } from "./agent-chat-controller";
import { applyCapabilities, setOperationBusy } from "../../operations/capabilities-store";
import { clearNotice } from "../../../app/notices-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { replaceAgentsFromSnapshot } from "../../dashboard/catalog-store";
import { resetPaneView, selectPane, setAgentChat } from "../session-store";
import { setPhase } from "../../connection/connection-store";
import { setScreen } from "../../../app/navigation-store";
import { bindSessionOwnerFromLive } from "../bind-live";
import { AgentChatPane } from "./agent-chat";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";

const handlers = { onBack() {}, onWorkspace() {}, onMenu() {}, onSwitch() {} };
const reply = (text: string): AgentTraceItem => ({ type: "assistant", text });
// A first user item keeps the view from pulling older pages to find its first turn.
const ask = (text: string): AgentTraceItem => ({ type: "user", text });
const texts = () => chatSnapshot().agentTraceItems.map(item => item.text);

function serve(page: AgentTracePage): void {
  attachLiveSession({
    isConnected: () => true,
    agentTrace: async () => page,
    promptAgent: async () => ({ outcome: "applied" }),
    sendKeys: async () => undefined,
  } as unknown as LiveSession);
}

async function refetch(page: AgentTracePage): Promise<void> {
  serve(page);
  await act(async () => { await refreshAgentTrace(); });
}

function display(items: AgentTraceItem[], next: string): void {
  applyTrace({
    agentTraceItems: items,
    agentTraceTail: items.length,
    agentTraceSig: JSON.stringify(items),
    agentTraceNext: next,
  });
}

beforeEach(async () => {
  await resetTestDOM();
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.requestAnimationFrame = happy.requestAnimationFrame.bind(happy);
  globals.cancelAnimationFrame = happy.cancelAnimationFrame.bind(happy);
  resetComposeDrafts();
  clearAgentTraceCache();
  resetPaneView();
  setLang("zh");
  setPhase("live");
  setScreen("pane");
  selectPane("p1");
  setCredential(null);
  setAgentChat(true);
  setTraceLoadState("ready");
  setOperationBusy(false);
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, prompt_agent: true, history: true }, []);
  replaceAgentsFromSnapshot({
    focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
    workspaces: [{ workspace_id: "w1", label: "demo" }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
    panes: [{
      pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/tmp/review",
      agent: "pi", agent_status: "idle", history_available: false,
    }],
  });
  clearNotice();
  bindSessionOwnerFromLive();
  act(() => renderReact(<AgentChatPane includeBack handlers={handlers} />));
  applyTrace({ agentTracePending: "", agentTraceNote: "" });
});
afterEach(() => {
  act(unmountReact);
  leaveAgentChat({ paint: false, rememberGuided: false });
  resetComposeDrafts();
  clearAgentTraceCache();
  attachLiveSession(null);
  selectPane("");
  setScreen("home");
});

test("a tail refetch overlapping the displayed tail keeps the items before the overlap", async () => {
  display([ask("a"), reply("b"), reply("c")], "cursor-old");
  await refetch({ items: [reply("c"), reply("d")], nextCursor: "cursor-new" });
  expect(texts()).toEqual(["a", "b", "c", "d"]);
});

test("that refetch leaves agentTraceNext at the oldest item held", async () => {
  display([ask("a"), reply("b"), reply("c")], "cursor-old");
  await refetch({ items: [reply("c"), reply("d")], nextCursor: "cursor-new" });
  expect(chatSnapshot().agentTraceNext).toBe("cursor-old");
});

test("a tail refetch sharing nothing with the displayed tail shows the new tail and its cursor", async () => {
  display([ask("a"), reply("b"), reply("c")], "cursor-old");
  await refetch({ items: [ask("x"), reply("y")], nextCursor: "cursor-new" });
  expect(texts()).toEqual(["x", "y"]);
  expect(chatSnapshot().agentTraceNext).toBe("cursor-new");
});

test("a terminal page is the complete history", async () => {
  display([ask("a"), reply("b"), reply("c")], "cursor-old");
  await refetch({ items: [reply("c"), reply("d")], nextCursor: null });
  expect(texts()).toEqual(["c", "d"]);
});
