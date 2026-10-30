import { happy, resetTestDOM } from "../../../../test-support/boot-dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { appRoot } from "../../../app/dom-root";
import { resetComposeDrafts } from "../drafts/compose-drafts";
import { clearAgentTraceCache } from "../../../lib/agent-trace-cache";
import { setLang } from "../../../lib/i18n";
import type { LiveSession } from "../../../lib/protocol/client";
import { ProtocolError } from "../../../lib/protocol/errors";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import { applyTrace, setTraceLoadState } from "./trace-store";
import { leaveAgentChat, refreshAgentTrace } from "./agent-chat-controller";
import { applyCapabilities, setOperationBusy } from "../../operations/capabilities-store";
import { clearNotice } from "../../../app/notices-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { replaceAgentsFromSnapshot } from "../../dashboard/catalog-store";
import { isAgentChat, resetPaneView, selectPane, setAgentChat } from "../session-store";
import { setPhase } from "../../connection/connection-store";
import { setScreen } from "../../../app/navigation-store";
import { bindSessionOwnerFromLive } from "../bind-live";
import { AgentChatPane } from "./agent-chat";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { paneTermMode, setPaneTermMode } from "../../settings/preferences-store";

const handlers = { onBack() {}, onWorkspace() {}, onMenu() {}, onSwitch() {} };

function deferred<T>() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((_, no) => { reject = no; });
  return { promise, reject };
}

function mount(): void {
  bindSessionOwnerFromLive();
  renderReact(<AgentChatPane includeBack handlers={handlers} />);
}
function stream(): HTMLElement { return appRoot().querySelector<HTMLElement>(".agent-stream")!; }
function setSession(agentTrace: () => Promise<never>): void {
  attachLiveSession({
    isConnected: () => true,
    agentTrace,
    promptAgent: async () => ({ outcome: "applied" }),
    sendKeys: async () => undefined,
  } as unknown as LiveSession);
}
const unavailable = async (): Promise<never> => { throw new ProtocolError("transcript_unavailable"); };

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
  applyTrace({ agentTraceItems: [], agentTraceNote: "", agentTracePending: "" });
  setOperationBusy(false);
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, prompt_agent: true, history: true }, []);
  replaceAgentsFromSnapshot({
    focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
    workspaces: [{ workspace_id: "w1", label: "demo" }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
    panes: ["p1", "p2"].map(paneId => ({
      pane_id: paneId, workspace_id: "w1", tab_id: "w1:t1", cwd: "/tmp/review",
      agent: "pi", agent_status: "idle", history_available: false,
    })),
  });
  clearNotice();
  setSession(unavailable);
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

test("auto preference leaves the chat view on transcript_unavailable", async () => {
  setPaneTermMode("p1", "auto");
  act(mount);
  await act(async () => { await refreshAgentTrace(); });
  expect(isAgentChat()).toBeFalse();
  expect(paneTermMode("p1")).toBe("auto");
});

test("explicit agent preference keeps the unavailable notice", async () => {
  setPaneTermMode("p1", "agent");
  act(mount);
  await act(async () => { await refreshAgentTrace(); });
  expect(isAgentChat()).toBeTrue();
  expect(stream().textContent).toContain("当前无法读取此会话的记录");
  expect(stream().querySelector(".agent-open-terminal")).not.toBeNull();
});

test("auto preference keeps the view when items or a pending turn exist", async () => {
  setPaneTermMode("p1", "auto");
  act(mount);
  applyTrace({ agentTraceItems: [{ type: "user", text: "Question" }] });
  await act(async () => { await refreshAgentTrace(); });
  expect(isAgentChat()).toBeTrue();

  applyTrace({ agentTraceItems: [], agentTracePending: "Run once" });
  await act(async () => { await refreshAgentTrace(); });
  expect(isAgentChat()).toBeTrue();
});

test("older page failure does not leave the chat view", async () => {
  setPaneTermMode("p1", "auto");
  act(mount);
  await act(async () => { await refreshAgentTrace(true); });
  expect(isAgentChat()).toBeTrue();
});

test("fallback of a retired request does nothing", async () => {
  setPaneTermMode("p1", "auto");
  setPaneTermMode("p2", "auto");
  const slow = deferred<never>();
  setSession(() => slow.promise);
  act(mount);
  let pending!: Promise<unknown>;
  act(() => { pending = refreshAgentTrace() as Promise<unknown>; });
  act(() => { selectPane("p2"); });
  slow.reject(new ProtocolError("transcript_unavailable"));
  await act(async () => { await pending; });
  expect(isAgentChat()).toBeTrue();
  expect(paneTermMode("p2")).toBe("auto");
});
