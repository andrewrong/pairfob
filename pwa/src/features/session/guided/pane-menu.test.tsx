import { resetBoardTestDOM } from "../../../../test-support/dom";
import { beforeEach, afterEach, expect, test } from "bun:test";
import { act } from "react";
import { closeTestDialogs } from "../../../../test-support/close-dialogs";
import { WorkspaceSnapshotRestorer } from "../../../../test-support/workspace-snapshot-restore";
import { setLang, t } from "../../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import { TERM_MODE_MENU } from "../../../lib/ui-model";
import {
  LIST_GROUP_KEY,
  TERM_COL_PRESETS,
  TERM_COLS_KEY,
  TERM_FIT_KEY,
  TERM_FONT_MAX,
  TERM_WRAP_KEY,
  listGroup,
  listGroupCollapsed,
  resetHerdPresentationChoices,
  setListGroup,
  setListGroupCollapsed,
  setPaneTermMode,
  setTermGrid,
  setTermWrap,
  setTermFontPx,
  termCols,
  termFit,
  termWrap,
  togglePanePin,
  type TermCols,
  type TermFit,
} from "../../settings/preferences-store";
import { type ListGroup } from "../../../lib/ranking";
import { setNetworkOnline, setPhase } from "../../connection/connection-store";
import { applyRuntimeIdentity, runtimeIdentity } from "../../connection/runtime-store";
import { setScreen } from "../../../app/navigation-store";
import { setComposeLive } from "../compose-store";
import {
  selectPane,
  setAgentChat,
  setFullTerminal,
  setTermSelect,
} from "../session-store";
import { applyCapabilities, setOperationBusy } from "../../operations/capabilities-store";
import { dashboardStore, replaceAgentsFromSnapshot } from "../../dashboard/catalog-store";
import { projectSnapshot } from "../../board/layout-store";
import { attachLiveSession } from "../../computers/catalog-store";
import { openPaneMenu } from "./pane-menu";
import { openPaneSwitcher } from "./pane-switcher";

const labels = () => [...document.querySelectorAll(".sheet-body button")].map((button) => button.textContent);
const sections = () => [...document.querySelectorAll(".menu-section-title")].map((node) => node.textContent);
const radio = (aria: string) => document.querySelector<HTMLButtonElement>(`[role=radio][aria-label="${aria}"]`)!;

function card(paneId: string, patch: { label?: string; status?: DashboardAgentStatus } = {}): Record<string, string> {
  return {
    pane_id: paneId, workspace_id: "w1", tab_id: "t1", cwd: "/one",
    agent: "codex", agent_status: patch.status ?? "idle", label: patch.label ?? "First",
  };
}
type DashboardAgentStatus = "idle" | "working" | "done" | "blocked" | "unknown";
function seedAgents(panes: Array<Record<string, string>>): void {
  replaceAgentsFromSnapshot({
    workspaces: [{ workspace_id: "w1", label: "One", cwd: "/one" }],
    tabs: [{ tab_id: "t1", workspace_id: "w1", label: "main" }],
    panes,
  });
}

// The pane-map seed re-projects the dashboard and prunes daemon-scoped pane
// preferences/pins (writing raw storage preimages); capture the foreign
// canonical maps/raw BEFORE any seed and restore AFTER own teardown so foreign
// domains/subscribers survive. Reset is narrow (named owners), never a global
// store reset or storage.clear.
const foreign = new WorkspaceSnapshotRestorer();

// The WorkspaceSnapshotRestorer intentionally does not cover the non-scoped
// scalar preferences this fixture's named setters persist (listGroup, termFit,
// termCols, termWrap), nor the in-memory fold that resetHerdPresentationChoices
// clears. Capture their canonical + exact raw preimages (strings or null) once
// per case BEFORE any seed/canonical write, and restore after own teardown with
// the raw preimages written LAST, so foreign scalar/fold values survive.
let preListGroup: ListGroup = "flat";
let preListGroupRaw: string | null = null;
let preTermFit: TermFit = "fit";
let preTermFitRaw: string | null = null;
let preTermCols: TermCols = 80;
let preTermColsRaw: string | null = null;
let preTermWrap = false;
let preTermWrapRaw: string | null = null;
let preCollapsed: Record<string, boolean> = {};
let scalarsCaptured = false;
function captureScalars(): void {
  if (scalarsCaptured) return;
  scalarsCaptured = true;
  preListGroup = listGroup();
  preListGroupRaw = localStorage.getItem(LIST_GROUP_KEY);
  preTermFit = termFit();
  preTermFitRaw = localStorage.getItem(TERM_FIT_KEY);
  preTermCols = termCols();
  preTermColsRaw = localStorage.getItem(TERM_COLS_KEY);
  preTermWrap = termWrap();
  preTermWrapRaw = localStorage.getItem(TERM_WRAP_KEY);
  preCollapsed = listGroupCollapsed();
}
function restoreScalars(): void {
  if (!scalarsCaptured) return;
  setListGroup(preListGroup);
  setTermGrid(preTermFit, preTermCols);
  setTermWrap(preTermWrap);
  setListGroupCollapsed(preCollapsed);
  // Exact raw preimages (strings or null) go LAST, after the canonical setters.
  if (preListGroupRaw === null) localStorage.removeItem(LIST_GROUP_KEY);
  else localStorage.setItem(LIST_GROUP_KEY, preListGroupRaw);
  if (preTermFitRaw === null) localStorage.removeItem(TERM_FIT_KEY);
  else localStorage.setItem(TERM_FIT_KEY, preTermFitRaw);
  if (preTermColsRaw === null) localStorage.removeItem(TERM_COLS_KEY);
  else localStorage.setItem(TERM_COLS_KEY, preTermColsRaw);
  if (preTermWrapRaw === null) localStorage.removeItem(TERM_WRAP_KEY);
  else localStorage.setItem(TERM_WRAP_KEY, preTermWrapRaw);
  scalarsCaptured = false;
}

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("zh");
  foreign.capture();
  captureScalars();
  setPhase("live");
  setScreen("pane");
  selectPane("p1");
  resetHerdPresentationChoices();
  setListGroup("flat");
  setFullTerminal(false);
  setAgentChat(false);
  setComposeLive(false);
  setTermWrap(false);
  setTermSelect(false);
  setPaneTermMode("p1", "guided");
  setOperationBusy(false);
  setTermGrid("fit", 120);
  setTermFontPx(14);
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES }, []);
  attachLiveSession({ isConnected: () => true } as never);
  seedAgents([card("p1")]);
});
afterEach(async () => await act(async () => {
  closeTestDialogs();
  await new Promise((resolve) => setTimeout(resolve, 10));
  foreign.restore();
  restoreScalars();
}));

const quick = () => document.querySelector(".pane-quick")!;
const rows = () => [...document.querySelectorAll(".sheet-body .menu-row")].map((row) => row.textContent);
const tiles = () => [...document.querySelectorAll(".sheet-body .menu-tile")].map((tile) => tile.getAttribute("aria-label"));
const sheetOpen = () => document.querySelector<HTMLDialogElement>("dialog.sheet")?.open === true;
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`.sheet-body button[aria-label="${label}"]`)!;

test("guided menu leads with in-place settings, then frequent actions, pages and a separate danger zone", () => {
  act(openPaneMenu);
  const dialog = document.querySelector<HTMLDialogElement>("dialog.sheet")!;
  expect(dialog.querySelector("h2")?.textContent).toBe(t("pane.menuTitle"));
  expect(dialog.querySelector(".sheet-subtitle")?.textContent).toBe("First");
  expect(dialog.classList.contains("is-expandable")).toBeTrue();
  expect(radio(TERM_MODE_MENU.guided).getAttribute("aria-checked")).toBe("true");
  expect(radio(TERM_MODE_MENU.agent).disabled).toBeTrue();
  expect(quick().textContent).toContain(t("menu.input"));
  expect(quick().querySelector(".menu-stepper-value")?.textContent).toBe(t("pane.fontPx", { n: 14 }));
  expect(quick().querySelector("[role=switch]")?.getAttribute("aria-label")).toBe(t("menu.wrap"));
  expect(tiles()).toEqual([t("menu.copyScreen"), t("menu.selectText")]);
  expect(rows()).toContain(t("pane.layoutPage"));
  expect(rows()).toContain(t("menu.renamePane"));
  expect(rows()).not.toContain(t("menu.worktree"));
  expect(document.querySelector(".menu-danger-zone")?.textContent).toBe(t("op.closePane"));
  expect(labels()).not.toContain(t("cancel"));
});

test("text size, wrap and input apply in place and keep the sheet open", async () => {
  act(openPaneMenu);
  act(() => byLabel(t("menu.fontUp")).click());
  expect(sheetOpen()).toBeTrue();
  expect(quick().querySelector(".menu-stepper-value")?.textContent).toBe(t("pane.fontPx", { n: 15 }));
  act(() => quick().querySelector<HTMLButtonElement>("[role=switch]")!.click());
  expect(sheetOpen()).toBeTrue();
  expect(termWrap()).toBeTrue();
  expect(quick().querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("true");
  setTermFontPx(TERM_FONT_MAX);
  act(() => { closeTestDialogs(); });
  act(openPaneMenu);
  expect(byLabel(t("menu.fontUp")).disabled).toBeTrue();
});

test("full terminal keeps reconnect and applies width in place, with no wrap switch", () => {
  setFullTerminal(true);
  setPaneTermMode("p1", "full");
  setTermGrid("fit", 120);
  act(openPaneMenu);
  expect(rows()).toContain(t("pane.reconnect"));
  expect(quick().querySelector("[role=switch]")).toBeNull();
  expect(radio(t("pane.fitAria")).getAttribute("aria-checked")).toBe("true");
  act(() => radio(t("pane.panColsAria", { cols: 100 })).click());
  expect(sheetOpen()).toBeTrue();
  expect(termFit()).toBe("pan");
  expect(termCols()).toBe(100);
  for (const cols of TERM_COL_PRESETS) expect(radio(t("pane.panColsAria", { cols })).getAttribute("aria-checked")).toBe(String(cols === 100));
});

test("agent chat omits terminal settings and screen actions while retaining pane operations", () => {
  setAgentChat(true);
  setPaneTermMode("p1", "agent");
  act(openPaneMenu);
  expect(radio(TERM_MODE_MENU.agent).disabled).toBeFalse();
  expect(quick().textContent).not.toContain(t("menu.input"));
  expect(quick().querySelector(".menu-stepper")).toBeNull();
  expect(tiles()).toEqual([]);
  expect(document.querySelector(".menu-danger-zone")?.textContent).toBe(t("op.closePane"));
});

test("capabilities reveal tiles and pages; Worktree and split open inside the same sheet", () => {
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, create_tab: true, split_pane: true, list_worktrees: true,
    create_worktree: true, open_worktree: true }, ["codex"]);
  act(openPaneMenu);
  const dialog = document.querySelector<HTMLDialogElement>("dialog.sheet")!;
  expect(tiles()).toEqual([t("menu.copyScreen"), t("menu.selectText"), t("menu.newTab"), t("menu.split")]);
  const worktree = [...document.querySelectorAll<HTMLButtonElement>(".menu-row")].find((row) => row.textContent === t("menu.worktree"))!;
  act(() => worktree.click());
  expect(document.querySelector<HTMLDialogElement>("dialog.sheet")).toBe(dialog);
  expect(dialog.querySelector("h2")?.textContent).toBe(t("menu.worktree"));
  expect(rows()).toEqual([t("menu.worktrees"), t("menu.newWorktree"), t("menu.openWorktree")]);
  act(() => dialog.querySelector<HTMLButtonElement>(".sheet-back")!.click());
  act(() => byLabel(t("menu.split")).click());
  expect(dialog.querySelector("h2")?.textContent).toBe(t("form.split"));
  const submit = dialog.querySelector<HTMLButtonElement>(".sheet-form-submit")!;
  expect(submit.textContent).toBe(t("form.splitRight"));
  act(() => dialog.querySelector<HTMLInputElement>('input[name="direction"][value="down"]')!.click());
  expect(submit.textContent).toBe(t("form.splitDown"));
  expect(dialog.querySelector('select[name="agent_kind"]')).not.toBeNull();
});

test("layout page previews the tab and keeps the daemon edge directions for each step", async () => {
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, resize_pane: true, swap_pane: true, zoom_pane: true }, []);
  const panes = [card("p1"), card("p2", { label: "Second" })];
  seedAgents(panes);
  projectSnapshot({ workspaces: [{ workspace_id: "w1", label: "One", cwd: "/one" }], tabs: [{ tab_id: "t1", workspace_id: "w1", label: "main" }],
    panes, layouts: [{ workspace_id: "w1", tab_id: "t1", zoomed: false, area: { x: 0, y: 0, width: 100, height: 40 },
      panes: [{ pane_id: "p1", focused: true, rect: { x: 0, y: 0, width: 50, height: 40 } },
        { pane_id: "p2", focused: false, rect: { x: 50, y: 0, width: 50, height: 40 } }] }] } as never, dashboardStore.get().agents as never);
  const calls: Array<Record<string, unknown>> = [];
  attachLiveSession({ isConnected: () => true, resizePane: async (input: Record<string, unknown>) => { calls.push(input); throw new Error("stop"); },
    swapPane: async (input: Record<string, unknown>) => { calls.push(input); throw new Error("stop"); } } as never);
  act(openPaneMenu);
  const layoutRow = [...document.querySelectorAll<HTMLButtonElement>(".menu-row")].find((row) => row.textContent === t("pane.layoutPage"))!;
  act(() => layoutRow.click());
  expect([...document.querySelectorAll(".pane-layout-cell")].map((cell) => cell.textContent)).toEqual([t("pane.thisCell"), "Second"]);
  expect(document.querySelector(".pane-layout-resize .menu-stepper-value")?.textContent).toBe(t("layout.share", { n: 50 }));
  expect(byLabel(t("form.swapLeft")).disabled).toBeTrue();
  for (const [label, direction] of [["form.wider", "right"], ["form.narrower", "left"]] as const) {
    await act(async () => { byLabel(t(label)).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(calls.at(-1)).toMatchObject({ pane_id: "p1", direction, amount: 0.15 });
  }
  await act(async () => { byLabel(t("form.swapRight")).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(calls.at(-1)).toMatchObject({ pane_id: "p1", direction: "right" });
  expect(sheetOpen()).toBeTrue();
  act(() => setNetworkOnline(false));
  try {
    expect(byLabel(t("form.wider")).disabled).toBeTrue();
    expect(document.querySelector(".pane-layout-status")?.textContent).toBe(t("boardMenu.offline"));
  } finally { act(() => setNetworkOnline(true)); }
});

test("switcher keeps ranked cards, pinned marker, active state and contextual metadata", () => {
  seedAgents([card("p1"), card("p2", { label: "Pinned", status: "working" })]);
  togglePanePin("p2");
  act(openPaneSwitcher);
  const items = [...document.querySelectorAll(".switch-item")];
  expect(items).toHaveLength(2);
  expect(items[0].querySelector(".switch-name")?.textContent).toBe("Pinned");
  expect(items[0].querySelector(".pin-mark")?.getAttribute("aria-hidden")).toBe("true");
  expect(items[1].classList.contains("on")).toBeTrue();
  expect(items[0].querySelector(".switch-meta")?.textContent).toContain(t("status.working"));
});

test("switcher states read like the header and turn unknown once contact is lost", () => {
  const identity = runtimeIdentity();
  act(() => applyRuntimeIdentity({ herdHost: identity.herdHost, runtimeKind: "herdr" }));
  try {
    seedAgents([card("p1")]);
    act(openPaneSwitcher);
    // An idle agent is "waiting for input" in the header and the list, not a bare "idle".
    expect(document.querySelector(".switch-meta")?.textContent).toContain(t("status.waitingInput"));
    act(() => closeTestDialogs());
    act(() => setNetworkOnline(false));
    act(openPaneSwitcher);
    expect(document.querySelector(".switch-meta")?.textContent).toContain(t("status.unverifiable"));
    expect(document.querySelector(".switch-item .agent-unknown")).not.toBeNull();
  } finally {
    act(() => { setNetworkOnline(true); applyRuntimeIdentity(identity); });
  }
});

test("empty switcher retains its explanation and cancel action", () => {
  seedAgents([]);
  act(openPaneSwitcher);
  expect(document.querySelector(".switch-list")?.textContent).toContain(t("home.switcherEmptyTitle"));
  expect(labels()).toContain(t("cancel"));
});