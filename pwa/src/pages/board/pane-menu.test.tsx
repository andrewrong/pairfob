import { happy, resetChatDOM } from "../../../test-support/chat-dom";
import { closeTestDialogs } from "../../../test-support/close-dialogs";
import { WorkspaceSnapshotRestorer } from "../../../test-support/workspace-snapshot-restore";
import { act } from "react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mountApp, unmountApp } from "../../app/mount";
import { commitView } from "../../app/host";
import { currentScreen, setScreen } from "../../app/navigation-store";
import { registerSessionOwnerPreparer } from "../../app/frame";
import { registerSessionView } from "../../features/session/register";
import { attachLiveSession } from "../../features/computers/catalog-store";
import { setNetworkOnline, setPhase } from "../../features/connection/connection-store";
import { replaceAgentsFromSnapshot } from "../../features/dashboard/catalog-store";
import { focusBoard, selectBoardTab, setBoardCamera, liveBoardCamera, liveBoardCatalog } from "../../features/board/layout-store";
import { boardInteractionStore, clearBoardInteraction } from "../../features/board/interaction-store";
import { applyCapabilities, setOperationBusy } from "../../features/operations/capabilities-store";
import { noteSnapshotAt, openPaneId, selectPane } from "../../features/session/session-store";
import { resetGenerationsForTests } from "../../features/connection/generations";
import { resetComposeDrafts } from "../../features/session/drafts/compose-drafts";
import { setLang, t } from "../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../lib/operations";
import { ProtocolError } from "../../lib/protocol/errors";
import { openBoardPaneMenu } from "./pane-menu";
import type { SnapshotWire } from "../../lib/dashboard";

const caps = { ...NO_OPERATION_CAPABILITIES, split_pane: true, resize_pane: true, swap_pane: true, zoom_pane: true };
let snapshot: SnapshotWire;
let calls: Array<{ method: string; value: unknown }>;
let failure = false;
let connected = true;
let splitWait: Promise<void> | undefined;
const projectionRestorer = new WorkspaceSnapshotRestorer();

beforeEach(async () => {
  await resetChatDOM();
  projectionRestorer.capture();
  connected = true; failure = false; calls = []; splitWait = undefined;
  resetGenerationsForTests(); resetComposeDrafts(); setOperationBusy(false); clearBoardInteraction();
  setLang("zh"); setPhase("live"); setNetworkOnline(true); setScreen("board"); selectPane("p1"); noteSnapshotAt(Date.now());
  registerSessionOwnerPreparer(registerSessionView);
  snapshot = { workspaces: [{ workspace_id: "w1", label: "demo" }],
    tabs: [{ workspace_id: "w1", tab_id: "t1", label: "tab one" }, { workspace_id: "w1", tab_id: "t2", label: "tab two" }],
    panes: ["p1", "p2"].map(pane_id => ({ pane_id, workspace_id: "w1", tab_id: "t1", cwd: "/tmp/demo", label: pane_id, agent: "", agent_status: "idle" })),
    layouts: [{ workspace_id: "w1", tab_id: "t1", zoomed: false, focused_pane_id: "p1", area: { x: 0, y: 0, width: 100, height: 40 },
      panes: ["p1", "p2"].map((pane_id, index) => ({ pane_id, focused: index === 0, rect: { x: index * 50, y: 0, width: 50, height: 40 } })) }],
  };
  const mutation = async (method: string, value: unknown) => {
    calls.push({ method, value });
    if (failure) throw new ProtocolError("unknown_outcome", "unknown_outcome");
    return { operation_id: "op_board0000000001", outcome: "applied" as const };
  };
  attachLiveSession({ isConnected: () => connected, snapshot: async () => snapshot,
    paneRead: async () => ({ text: "pane", hash: "hash" }),
    resizePane: input => mutation("resize", input), swapPane: input => mutation("swap", input), zoomPane: input => mutation("zoom", input),
    renamePane: async (id, label) => { await mutation("rename", { id, label }); },
    closePane: async id => { await mutation("close", id); snapshot.panes = snapshot.panes?.filter(pane => pane.pane_id !== id); },
    splitPane: async input => {
      await mutation("split", input);
      await splitWait;
      snapshot.panes!.push({ pane_id: "p3", workspace_id: "w1", tab_id: "t1", cwd: "/tmp/demo", agent: "" });
      return { operation_id: "op_board0000000001", outcome: "applied", pane_id: "p3", workspace_id: "w1", tab_id: "t1" };
    },
  });
  applyCapabilities(caps, []); replaceAgentsFromSnapshot(snapshot); focusBoard("w1", "t1");
  act(() => { mountApp(); commitView(); });
});
afterEach(async () => {
  closeTestDialogs();
  await act(async () => { await Promise.resolve(); });
  act(() => unmountApp()); clearBoardInteraction(); attachLiveSession(null); setOperationBusy(false);
  projectionRestorer.restore();
});

async function open() {
  const tile = document.querySelector<HTMLElement>('.board-pane[data-pane-id="p2"]')!;
  let finished!: Promise<void>;
  await act(async () => { finished = openBoardPaneMenu("p2", { x: 180, y: 300 }, tile, { openPane: () => {}, revealPane: () => {} }); });
  return { finished };
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(button => button.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => { button.click(); await Promise.resolve(); });
}
async function submit() {
  const form = document.querySelector("dialog form")!;
  await act(async () => { form.dispatchEvent(new happy.Event("submit", { bubbles: true, cancelable: true })); });
}

test("split targets the pressed pane while preserving the current session and board", async () => {
  const { finished } = await open();
  await click(t("boardMenu.down"));
  expect(document.querySelector(".board-split-preview.down")?.textContent).toContain("p2");
  await submit(); await act(async () => { await finished; });
  expect(calls).toEqual([{ method: "split", value: { pane_id: "p2", direction: "down", ratio: 0.5, cwd: "/tmp/demo" } }]);
  expect(openPaneId()).toBe("p1"); expect(currentScreen()).toBe("board");
  expect(boardInteractionStore.get().createdPaneId).toBe("p3");
});

test("inline resize stays open, acts on p2 and rechecks capabilities before another command", async () => {
  await open(); await click(t("form.wider"));
  expect(calls).toEqual([{ method: "resize", value: { pane_id: "p2", direction: "right", amount: 0.15 } }]);
  expect(document.querySelector("dialog")?.textContent).toContain(t("boardMenu.done"));
  await act(async () => applyCapabilities(NO_OPERATION_CAPABILITIES, []));
  expect(document.querySelector("dialog")?.textContent).not.toContain(t("form.wider"));
  expect(calls).toHaveLength(1);
});

test("changing tabs closes the menu and invalidates a pending split form even if the tab returns", async () => {
  let opened = await open();
  await act(async () => { selectBoardTab("t2"); await Promise.resolve(); });
  await opened.finished;
  expect(document.querySelector("dialog")).toBeNull();
  await act(async () => selectBoardTab("t1"));
  opened = await open(); await click(t("boardMenu.right"));
  act(() => { selectBoardTab("t2"); selectBoardTab("t1"); });
  await submit(); await act(async () => { await opened.finished; });
  expect(calls).toEqual([]);
});

test("unknown outcome refreshes without repeating the mutation and keeps the panel usable", async () => {
  failure = true;
  await open(); await click(t("form.wider"));
  expect(calls).toHaveLength(1);
  expect(document.querySelector("dialog")?.textContent).toContain(t("boardMenu.done"));
  expect(document.querySelectorAll("dialog button:disabled").length).toBeLessThan(document.querySelectorAll("dialog button").length);
});

test("disconnect disables menu commands and closing the target externally retires the menu", async () => {
  const { finished } = await open();
  connected = false;
  await act(async () => setNetworkOnline(false));
  expect([...document.querySelectorAll<HTMLButtonElement>('dialog [role="menuitem"]')].every(button => button.disabled)).toBe(true);
  expect(document.querySelector("dialog")?.textContent).toContain(t("boardMenu.offline"));
  snapshot.panes = snapshot.panes?.filter(pane => pane.pane_id !== "p2");
  await act(async () => { replaceAgentsFromSnapshot(snapshot); await Promise.resolve(); });
  await finished;
  expect(document.querySelector("dialog")).toBeNull(); expect(calls).toEqual([]);
});


test("split preserves a fitted custom camera and an in-flight result cannot pull the reader back to its tab", async () => {
  act(() => setBoardCamera({ scale: 1.8, panX: -75, panY: 40 }, true));
  let opened = await open(); await click(t("boardMenu.right")); await submit();
  await act(async () => { await opened.finished; });
  expect(liveBoardCamera()).toMatchObject({ scale: 1.8, panX: -75, panY: 40, fitted: true });
  let release!: () => void;
  splitWait = new Promise<void>(resolve => { release = resolve; });
  opened = await open(); await click(t("boardMenu.down")); await submit();
  expect(calls).toHaveLength(2);
  await act(async () => selectBoardTab("t2"));
  await act(async () => { release(); await opened.finished; });
  expect(liveBoardCatalog().tabId).toBe("t2");
  expect(boardInteractionStore.get().createdPaneId).toBe("");
});
