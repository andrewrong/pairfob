import { resetBoardTestDOM } from "../../../../test-support/dom";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { DashboardAgentCard } from "../../../lib/dashboard";
import type { HerdPaint } from "../../../lib/herd-attention";
import { setLang, t } from "../../../lib/i18n";
import { PINNED_GROUP_ID } from "../../../lib/ranking";
import { appRoot } from "../../../app/dom-root";
import { clearNotice, showStatus } from "../../../app/notices-store";
import { setOperationBusy } from "../../operations/capabilities-store";
import { preferencesStore } from "../../settings/preferences-store";
import { selectPane } from "../../session/session-store";
import { replaceAgentsFromSnapshot } from "../catalog-store";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import type { HerdActions } from "../actions";

const app = appRoot;
import { buildHerdViewModel, type HerdModelInput, type HerdViewModel } from "../model/herd-view";
import { HerdScreen } from "./herd-screen";

function agent(id: string, workspace: string, status: DashboardAgentCard["status"] = "idle"): DashboardAgentCard {
  return {
    paneId: id, paneLabel: id, agent: "codex", hasAgent: true, status,
    workspaceId: workspace, workspaceLabel: workspace, cwd: `/tmp/${workspace}`, tabId: `${workspace}:tab`,
  };
}

const noAttention: HerdPaint = { stagger: false, markOf: () => "", isDismissing: () => false, completed: [] };

function model(overrides: Partial<HerdModelInput> = {}): HerdViewModel {
  return buildHerdViewModel({
    agents: [agent("p1", "alpha"), agent("p2", "beta", "working")],
    listGroup: "flat",
    paneTouched: {},
    panePinned: {},
    groupCollapsed: {},
    selectedPaneId: "p1",
    attention: noAttention,
    liveness: "live",
    status: { tone: "live", text: "已连接" },
    connected: true,
    networkOnline: true,
    runtimeKind: "herdr",
    createConversation: true,
    operationBusy: false,
    computerCount: 1,
    morphingPaneId: null,
    ...overrides,
  });
}

let calls: string[] = [];

const actions: HerdActions = {
  openPaneFromCard: (paneId, title) => calls.push(`openPane:${paneId}:${title?.className ?? "no-title"}`),
  openPaneMenu: (card) => calls.push(`paneMenu:${card.paneId}`),
  openWorkspaceMenu: (card) => calls.push(`workspaceMenu:${card?.paneId ?? "none"}`),
  toggleGroup: (groupId, groupIds) => calls.push(`toggle:${groupId}:${groupIds.join(",")}`),
  createConversation: () => calls.push("create"),
  openBoard: () => calls.push("board"),
  openSettings: () => calls.push("settings"),
  openComputers: () => calls.push("computers"),
  runEmptyAction: (kind) => calls.push(`empty:${kind}`),
  openTabLayout: (workspaceId, tabId) => calls.push(`layout:${workspaceId}:${tabId}`),
  createTabIn: (anchor) => calls.push(`newTab:${anchor?.paneId ?? "none"}`),
  setHomeView: (view) => calls.push(`view:${view}`),
  chooseGrouping: () => calls.push("grouping"),
  togglePin: (card) => calls.push(`pin:${card.paneId}`),
};

function paint(view: HerdViewModel, variant: "page" | "rail" = "page"): void {
  act(() => renderReact(<HerdScreen view={view} actions={actions} variant={variant} />));
}

function cardMain(name: string): HTMLButtonElement {
  const found = [...app().querySelectorAll<HTMLButtonElement>(".card-main")].find((node) => node.textContent?.includes(name));
  if (!found) throw new Error(`missing card ${name}: ${app().textContent?.slice(0, 200)}`);
  return found;
}

function hold(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
}

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("zh");
  calls = [];
  clearNotice();
});

afterEach(() => {
  act(() => unmountReact());
  clearNotice();
});

describe("herd screen presentation", () => {
  test("the screen renders the model it was handed, not the live record", () => {
    const view = model();
    // The live domains move on before React runs: empty herd, busy, a different
    // selection. The screen must still render exactly the props it was handed —
    // these four assertions reject a regression that reads global state instead.
    act(() => {
      replaceAgentsFromSnapshot({ panes: [] });
      setOperationBusy(true);
      selectPane("other");
    });
    paint(view);
    expect([...app().querySelectorAll(".card-name")].map((node) => node.textContent)).toEqual(["p1", "p2"]);
    expect(app().querySelectorAll(".card.sel")).toHaveLength(1);
    expect(app().querySelector(".card.status-working")).not.toBeNull();
    expect(app().querySelector<HTMLButtonElement>(".topbar-create")?.disabled).toBe(false);
  });

  test("the page carries notices above the list, the desktop rail carries none", () => {
    act(() => showStatus("notice above cards", true));
    paint(model(), "page");
    expect(app().firstElementChild?.className).toBe("page herd-screen");
    const children = [...app().querySelector(".page")!.children];
    const noticeAt = children.findIndex((node) => node.matches("[data-react-notice]"));
    const listAt = children.findIndex((node) => node.matches(".herd-body"));
    expect(noticeAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(noticeAt);
    expect(children[noticeAt].textContent).toBe("notice above cards");
    expect(children.map((node) => node.className).slice(0, 3)).toEqual(["topbar herd-topbar", "herd-heading", "statusline herd-summary"]);
    expect(children.at(-1)?.className).toBe("herd-create-bar");
    paint(model(), "rail");
    expect(app().firstElementChild?.className).toBe("rail herd-screen");
    expect(app().querySelector(".rail [data-react-notice]")).toBeNull();
    expect(app().querySelector(".rail .herd-list")).not.toBeNull();
    expect(app().querySelector(".rail .topbar")).not.toBeNull();
  });

  test("a card click opens its pane with the title element, a hold asks for the pane menu", () => {
    paint(model());
    act(() => cardMain("p1").click());
    expect(calls).toEqual(["openPane:p1:card-title"]);
    calls = [];
    hold(cardMain("p2"));
    expect(calls).toEqual(["paneMenu:p2"]);
  });

  test("grouped mode toggles through the action and only a workspace heading owns a menu", () => {
    paint(model({
      listGroup: "space",
      agents: [agent("p1", "alpha"), agent("p2", "beta")],
      panePinned: { p2: 4 },
      groupCollapsed: {},
    }));
    const headings = [...app().querySelectorAll<HTMLButtonElement>(".group-title")];
    expect(headings.map((node) => node.getAttribute("aria-haspopup"))).toEqual([null, "menu"]);
    expect(headings.map((node) => node.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
    act(() => headings[1].click());
    // The fold carries the order this list was rendered from, not the record's.
    expect(calls).toEqual([`toggle:alpha:${PINNED_GROUP_ID},alpha`]);
    calls = [];
    hold(headings[0]);
    expect(calls).toEqual([]);
    hold(headings[1]);
    expect(calls).toEqual(["workspaceMenu:p1"]);
  });

  test("flat mode keeps bare section titles and the stagger indices", () => {
    paint(model({ attention: { ...noAttention, stagger: true } }));
    expect(app().querySelector(".herd-list")?.className).toBe("herd-list enter");
    expect(app().querySelector(".group-title")).toBeNull();
    expect([...app().querySelectorAll<HTMLElement>(".section-title, .card")].map((node) => node.style.getPropertyValue("--i")))
      .toEqual(["0", "1", "2"]);
  });

  test("the empty state runs the action kind the model chose", () => {
    paint(model({ agents: [], createConversation: false, connected: false, networkOnline: false }));
    expect(app().querySelector(".herd-list")).toBeNull();
    const action = app().querySelector<HTMLButtonElement>(".empty-action")!;
    expect(action.textContent).toBe(t("empty.actionRetry"));
    act(() => action.click());
    expect(calls).toEqual(["empty:retry"]);
  });

  test("each control fires one narrow action and follows the model gates", () => {
    paint(model({ computerCount: 2 }));
    const click = (selector: string) => act(() => app().querySelector<HTMLButtonElement>(selector)!.click());
    click(".herd-create-bar .topbar-create");
    click(".herd-computer");
    click(".herd-settings");
    click(".herd-grouping");
    act(() => app().querySelectorAll<HTMLButtonElement>(".herd-view-option")[1].click());
    expect(calls).toEqual(["create", "computers", "settings", "grouping", "view:layout"]);
    expect(app().querySelector(".herd-create-bar")?.textContent).toBe(t("form.newConversation"));
    expect(app().querySelector(".herd-computer")?.textContent).toBe("已连接");
    calls = [];
    paint(model({ createConversation: false, computerCount: 1, operationBusy: true }));
    expect(app().querySelector(".topbar-create")).toBeNull();
    expect([...app().querySelectorAll(".topbar-actions button")]).toHaveLength(1);
  });

  test("the layout view draws each tab's split and routes cells, captions and new tabs", () => {
    const agents = [agent("p1", "alpha"), agent("p2", "alpha", "working")];
    const layout = {
      workspaceId: "alpha", tabId: "alpha:tab", zoomed: false, focusedPaneId: "p1",
      area: { x: 0, y: 0, width: 100, height: 40 },
      panes: [
        { paneId: "p1", focused: true, rect: { x: 0, y: 0, width: 50, height: 40 } },
        { paneId: "p2", focused: false, rect: { x: 50, y: 0, width: 50, height: 40 } },
      ],
    };
    paint(model({ agents, homeView: "layout", createTab: true, board: {
      workspaces: [{ id: "alpha", label: "alpha" }], tabs: [{ id: "alpha:tab", workspaceId: "alpha", label: "auth" }], layouts: [layout],
    } }));
    expect(app().querySelector(".herd-list")).toBeNull();
    expect(app().querySelector(".herd-grouping")).toBeNull();
    const cells = [...app().querySelectorAll<HTMLButtonElement>(".layout-cell")];
    expect(cells.map((cell) => [cell.style.left, cell.style.width])).toEqual([["0.000%", "50.000%"], ["50.000%", "50.000%"]]);
    expect(cells[1].classList.contains("status-working")).toBe(true);
    act(() => cells[1].click());
    act(() => app().querySelector<HTMLButtonElement>(".layout-tab-caption")!.click());
    act(() => app().querySelector<HTMLButtonElement>(".layout-tab-new")!.click());
    act(() => app().querySelector<HTMLButtonElement>(".layout-space .group-more")!.click());
    expect(calls).toEqual(["openPane:p2:no-title", "layout:alpha:alpha:tab", "newTab:p1", "workspaceMenu:p1"]);
    expect(app().querySelector(".layout-tab-name")?.textContent).toBe("auth");
  });

  test("a revealed row offers pin and more without opening the pane", () => {
    paint(model());
    const row = cardMain("p1").closest("article")!;
    const [pin, more] = [...row.querySelectorAll<HTMLButtonElement>(".card-trail-act")];
    expect(pin.textContent).toBe(t("menu.pin"));
    act(() => pin.click());
    act(() => more.click());
    expect(calls).toEqual(["pin:p1", "paneMenu:p1"]);
  });

  test("shows every task status without status filter pills and keeps card actions", () => {
    paint(model({ agents: [agent("wait", "alpha", "blocked"), agent("run", "alpha", "working"), agent("done", "alpha", "done")] }));
    expect(app().querySelector(".attention-filters")).toBeNull();
    expect([...app().querySelectorAll(".card-name")].map((node) => node.textContent).sort()).toEqual(["done", "run", "wait"]);
    act(() => cardMain("wait").click());
    expect(calls).toEqual(["openPane:wait:card-title"]);
  });

  test("completion count focuses a completed card without hiding other tasks", () => {
    const checking = { ...agent("check", "alpha", "idle"), interactiveReady: false };
    paint(model({
      listGroup: "space",
      agents: [checking, agent("done", "beta", "done")],
      groupCollapsed: {},
    }));
    act(() => app().querySelector<HTMLButtonElement>(".done-count")!.click());
    expect([...app().querySelectorAll(".card-name")].map((node) => node.textContent).sort()).toEqual(["check", "done"]);
    expect(document.activeElement).toBe(app().querySelector(".card.status-done .card-main"));
  });

  test("attention shortcuts cycle independently without opening or filtering cards", () => {
    paint(model({ agents: [agent("a", "alpha", "blocked"), agent("b", "alpha", "blocked"),
      agent("c", "alpha", "done"), agent("d", "alpha", "done")] }));
    const click = (selector: string) => act(() => app().querySelector<HTMLButtonElement>(selector)!.click());
    const focused = () => (document.activeElement as HTMLElement).dataset.paneId;
    click(".pending-count"); expect(focused()).toBe("a");
    click(".done-count"); expect(focused()).toBe("c");
    click(".pending-count"); expect(focused()).toBe("b");
    click(".pending-count"); expect(focused()).toBe("a");
    click(".done-count"); expect(focused()).toBe("d");
    expect(calls).toEqual([]);
    expect(app().querySelectorAll(".card-main")).toHaveLength(4);
  });

  test("attention expands the target group and focuses after the new projection", () => {
    const agents = [agent("wait", "alpha", "blocked"), agent("done", "beta", "done")];
    const input = { agents, listGroup: "space" as const, groupCollapsed: { alpha: true, beta: true } };
    paint(model(input));
    act(() => app().querySelector<HTMLButtonElement>(".pending-count")!.click());
    expect(preferencesStore.get().listGroupCollapsed.alpha).toBe(false);
    paint(model({ ...input, groupCollapsed: { alpha: false, beta: true } }));
    expect((document.activeElement as HTMLElement).dataset.paneId).toBe("wait");
    expect([...app().querySelectorAll(".group-title")].map(node => node.getAttribute("aria-expanded"))).toEqual(["true", "false"]);
  });

  test("stale sessions do not present attention shortcuts as current", () => {
    paint(model({ agents: [agent("wait", "alpha", "blocked"), agent("done", "beta", "done")], liveness: "unverifiable" }));
    expect(app().querySelector(".pending-count")).toBeNull();
    expect(app().querySelector(".done-count")).toBeNull();
    expect(app().querySelectorAll(".card.unverifiable")).toHaveLength(2);
  });

  test("grouped results still honor collapse and expand actions", () => {
    const checking = { ...agent("check", "alpha", "idle"), interactiveReady: false };
    const input = { listGroup: "space" as const, agents: [checking], groupCollapsed: {} };
    paint(model(input));
    const heading = app().querySelector<HTMLButtonElement>(".group-title")!;
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    act(() => heading.click());
    expect(calls).toEqual(["toggle:alpha:alpha"]);
    calls = [];
    paint(model({ ...input, groupCollapsed: { alpha: true } }));
    expect(app().querySelector<HTMLButtonElement>(".group-title")?.getAttribute("aria-expanded")).toBe("false");
    act(() => app().querySelector<HTMLButtonElement>(".group-title")!.click());
    expect(calls).toEqual(["toggle:alpha:alpha"]);
  });

  test("the status line keeps its tone, text and completion count", () => {
    paint(model({ agents: [agent("p1", "alpha", "done"), agent("p2", "beta", "done")], status: { tone: "warn", text: t("chrome.unverifiable") } }));
    expect(app().querySelector(".herd-computer .dot-warn")).not.toBeNull();
    expect(app().querySelector(".herd-computer-text")?.textContent).toBe(t("chrome.unverifiable"));
    expect(app().querySelector(".herd-summary .statusline-text")?.textContent).toBe(t("home.sessionCount", { count: "2" }));
    expect(app().querySelector(".done-count")?.textContent).toBe(t("home.doneCount", { count: "2" }));
    paint(model({ agents: [agent("p1", "alpha", "idle")] }));
    expect(app().querySelector(".done-count")).toBeNull();
  });
});
