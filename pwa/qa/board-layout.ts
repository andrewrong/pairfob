import type { SnapshotWire } from "../src/lib/dashboard";
import { parseSnapshotLayouts, type TabLayout } from "../src/lib/layout";
import type { SplitPaneInput, SwapPaneInput, ResizePaneInput, ZoomPaneInput } from "../src/lib/operations";

/** Small deterministic layout fixture for UI feedback; not Herdr semantics. */
export function boardLayoutFixture(snapshot: SnapshotWire) {
  const layouts = parseSnapshotLayouts(snapshot);
  let serial = 10;
  const saved = new Map<string, TabLayout["panes"]>();
  const publish = () => {
    snapshot.layouts = layouts.filter(layout => layout.panes.length).map(layout => ({
      workspace_id: layout.workspaceId, tab_id: layout.tabId, area: layout.area,
      zoomed: layout.zoomed, focused_pane_id: layout.focusedPaneId,
      panes: layout.panes.map(pane => ({ pane_id: pane.paneId, rect: pane.rect, focused: pane.focused })),
    }));
  };
  const target = (id: string) => {
    const layout = layouts.find(layout => layout.panes.some(pane => pane.paneId === id));
    const pane = layout?.panes.find(pane => pane.paneId === id);
    if (!layout || !pane) throw new Error("QA layout target missing");
    return { layout, pane };
  };
  return {
    split(input: SplitPaneInput) {
      const { layout, pane } = target(input.pane_id);
      const original = snapshot.panes?.find(pane => pane.pane_id === input.pane_id);
      const id = `${layout.workspaceId}:p${++serial}`;
      const rect = { ...pane.rect };
      if (input.direction === "right") { pane.rect.width /= 2; rect.x += pane.rect.width; rect.width = pane.rect.width; }
      else { pane.rect.height /= 2; rect.y += pane.rect.height; rect.height = pane.rect.height; }
      layout.panes.push({ paneId: id, focused: false, rect });
      snapshot.panes?.push({ ...original, workspace_id: layout.workspaceId, tab_id: layout.tabId,
        pane_id: id, cwd: input.cwd || original?.cwd, agent: input.agent_kind || "", agent_status: "idle", label: `New pane ${serial}` });
      publish();
      return { workspace_id: layout.workspaceId, tab_id: layout.tabId, pane_id: id };
    },
    swap(input: SwapPaneInput) {
      const { layout, pane } = target(input.pane_id);
      const other = layout.panes.find(other => other !== pane && (
        input.direction === "left" ? other.rect.x < pane.rect.x : input.direction === "right" ? other.rect.x > pane.rect.x
          : input.direction === "up" ? other.rect.y < pane.rect.y : other.rect.y > pane.rect.y));
      if (other) [pane.rect, other.rect] = [other.rect, pane.rect];
      publish();
    },
    resize(input: ResizePaneInput) {
      const { layout, pane } = target(input.pane_id);
      // Initial fixture is a horizontal pair; reject unsupported fixture shapes.
      const [left, right] = [...layout.panes].sort((a, b) => a.rect.x - b.rect.x);
      if (layout.panes.length !== 2 || !left || !right || !["left", "right"].includes(input.direction)) throw new Error("QA resize requires the original horizontal pair");
      const step = layout.area.width * (input.amount ?? 0.15) * (input.direction === "right" ? 1 : -1) * (pane === left ? 1 : -1);
      const width = Math.max(10, Math.min(layout.area.width - 10, left.rect.width + step));
      left.rect.width = width; right.rect.x = width; right.rect.width = layout.area.width - width;
      publish();
    },
    zoom(input: ZoomPaneInput) {
      const { layout } = target(input.pane_id);
      const zoom = input.mode === "toggle" ? !layout.zoomed : input.mode === "on";
      if (zoom && !layout.zoomed) {
        saved.set(layout.tabId, structuredClone(layout.panes));
        layout.panes = [{ paneId: input.pane_id, rect: { ...layout.area }, focused: true }];
      } else if (!zoom && saved.has(layout.tabId)) layout.panes = saved.get(layout.tabId)!;
      layout.zoomed = zoom; layout.focusedPaneId = input.pane_id; publish();
    },
    close(id: string) {
      for (const layout of layouts) layout.panes = layout.panes.filter(pane => pane.paneId !== id);
      publish();
    },
  };
}
