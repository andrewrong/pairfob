import { t, type CopyKey } from "../../../lib/i18n";
import type { TabLayoutView } from "../../../lib/layout";
import type { LayoutDirection, OperationCapabilities } from "../../../lib/operations";

export type BoardPaneAction = "open" | "right" | "down" | "resize" | "swap" | "zoom" | "rename" | "close";
export type BoardLayoutAction = { kind: "resize" | "swap"; direction: LayoutDirection };
export type PaneMenuEntry = { id: BoardPaneAction; label: string; reason?: string; group: number; danger?: boolean };
export type PaneMenuModel = {
  title: string;
  subtitle: string;
  entries: PaneMenuEntry[];
  disabledReason: string;
  layout: TabLayoutView | null;
  paneId: string;
  notice: string;
};

/** Candidate rectangles, not a promise about the daemon's neighbor selection. */
export function directionalPanes(layout: TabLayoutView | null, paneId: string, direction: LayoutDirection): string[] {
  const pane = layout?.panes.find(pane => pane.paneId === paneId);
  if (!pane || !layout || layout.zoomed) return [];
  const a = pane.rect;
  return layout.panes.filter(other => {
    if (other.paneId === paneId) return false;
    const b = other.rect;
    const verticalOverlap = Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
    const horizontalOverlap = Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x);
    switch (direction) {
      case "left": return verticalOverlap && b.x + b.width <= a.x;
      case "right": return verticalOverlap && b.x >= a.x + a.width;
      case "up": return horizontalOverlap && b.y + b.height <= a.y;
      case "down": return horizontalOverlap && b.y >= a.y + a.height;
    }
  }).map(pane => pane.paneId);
}

export function layoutActionReason(model: PaneMenuModel, action: BoardLayoutAction): string {
  if (model.disabledReason) return model.disabledReason;
  const layout = model.layout;
  if (!layout || layout.zoomed || layout.panes.length < 2) return t("boardMenu.unavailable");
  if (action.kind === "swap") return directionalPanes(layout, model.paneId, action.direction).length ? "" : t("boardMenu.noNeighbor");
  const pane = layout.panes.find(pane => pane.paneId === model.paneId);
  const horizontal = action.direction === "left" || action.direction === "right";
  return pane && (horizontal ? pane.rect.width < layout.area.width : pane.rect.height < layout.area.height)
    ? "" : t("boardMenu.unavailable");
}

export const layoutButtons: Record<"resize" | "swap", Array<{ direction: LayoutDirection; label: CopyKey }>> = {
  resize: [
    { direction: "right", label: "form.wider" }, { direction: "left", label: "form.narrower" },
    { direction: "up", label: "form.taller" }, { direction: "down", label: "form.shorter" },
  ],
  swap: [
    { direction: "left", label: "form.swapLeft" }, { direction: "right", label: "form.swapRight" },
    { direction: "up", label: "form.swapUp" }, { direction: "down", label: "form.swapDown" },
  ],
};

export function paneMenuEntries(caps: OperationCapabilities, layout: TabLayoutView | null, disabledReason: string): PaneMenuEntry[] {
  const entries: PaneMenuEntry[] = [{ id: "open", label: t("boardMenu.open"), group: 0 }];
  if (caps.split_pane) entries.push(
    { id: "right", label: t("boardMenu.right"), group: 1 },
    { id: "down", label: t("boardMenu.down"), group: 1 },
  );
  const split = !!layout && layout.panes.length > 1;
  if (caps.resize_pane && split) entries.push({ id: "resize", label: t("boardMenu.resize"), group: 1,
    reason: layout?.zoomed ? t("boardMenu.unavailable") : undefined });
  if (caps.swap_pane && split) entries.push({ id: "swap", label: t("boardMenu.swap"), group: 1,
    reason: layout?.zoomed ? t("boardMenu.unavailable") : undefined });
  if (caps.zoom_pane && (split || layout?.zoomed)) entries.push({ id: "zoom",
    label: t(layout?.zoomed ? "boardMenu.restore" : "boardMenu.maximize"), group: 1 });
  entries.push({ id: "rename", label: t("boardMenu.rename"), group: 2 },
    { id: "close", label: t("boardMenu.close"), group: 2, danger: true });
  return entries.map(entry => ({ ...entry, reason: disabledReason || entry.reason }));
}
