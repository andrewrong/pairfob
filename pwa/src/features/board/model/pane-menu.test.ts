import { expect, test } from "bun:test";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import type { TabLayout } from "../../../lib/layout";
import { directionalPanes, layoutActionReason, paneMenuEntries, type PaneMenuModel } from "./pane-menu";

const layout: TabLayout = { workspaceId: "w", tabId: "t", focusedPaneId: "a", zoomed: false,
  area: { x: 0, y: 0, width: 100, height: 40 }, panes: [
    { paneId: "a", focused: true, rect: { x: 0, y: 0, width: 60, height: 40 } },
    { paneId: "b", focused: false, rect: { x: 60, y: 0, width: 40, height: 20 } },
    { paneId: "c", focused: false, rect: { x: 60, y: 20, width: 40, height: 20 } },
  ] };
const caps = { ...NO_OPERATION_CAPABILITIES, split_pane: true, resize_pane: true, swap_pane: true, zoom_pane: true };
const model = (paneId: string, extra: Partial<PaneMenuModel> = {}): PaneMenuModel => ({
  title: paneId, subtitle: "", layout, paneId, disabledReason: "", entries: [], notice: "", ...extra,
});

test("missing capabilities never invent layout actions; reconnect keeps actions visibly disabled", () => {
  expect(paneMenuEntries(NO_OPERATION_CAPABILITIES, layout, "").map(entry => entry.id)).toEqual(["open", "rename", "close"]);
  expect(paneMenuEntries(caps, layout, "offline").every(entry => entry.reason === "offline")).toBe(true);
});
test("zoomed layout still offers restore with a single visible pane and hides unusable sizing", () => {
  const zoomed = { ...layout, zoomed: true, panes: [layout.panes[0]] };
  expect(paneMenuEntries(caps, zoomed, "").map(entry => entry.id)).toEqual(["open", "right", "down", "zoom", "rename", "close"]);
});
test("direction candidates require overlapping edges, including multiple neighbors", () => {
  expect(directionalPanes(layout, "a", "right")).toEqual(["b", "c"]);
  expect(directionalPanes(layout, "b", "down")).toEqual(["c"]);
  expect(directionalPanes(layout, "b", "up")).toEqual([]);
  expect(directionalPanes(layout, "a", "left")).toEqual([]);
});
test("resize axes and swap boundaries are constrained by the current layout", () => {
  expect(layoutActionReason(model("a"), { kind: "resize", direction: "right" })).toBe("");
  expect(layoutActionReason(model("a"), { kind: "resize", direction: "up" })).not.toBe("");
  expect(layoutActionReason(model("b"), { kind: "resize", direction: "up" })).toBe("");
  expect(layoutActionReason(model("b"), { kind: "swap", direction: "right" })).not.toBe("");
  expect(layoutActionReason(model("b", { disabledReason: "busy" }), { kind: "swap", direction: "left" })).toBe("busy");
});
