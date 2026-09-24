import { paneRow, setPaneRow } from "../session-store";
import { showError, showStatus } from "../../../app/notices-store";
import { commitView } from "../../../app/host";
import { haptic } from "../../../lib/dom";
import { t } from "../../../lib/i18n";
import { rowPath, rowText } from "../../../lib/termrow";
import { insertCompose } from "./compose";
import { paneModel, type PaneModel } from "./pane-model";
import { termElement } from "./term";

/** Air between the picked row and the bubble. */
const BUBBLE_GAP_PX = 6;

export function rowBarContent(model: PaneModel): { index: number; text: string; path: string | null } | null {
  const index = paneRow();
  if (index === null) return null;
  const raw = model.texts[index];
  if (raw === undefined) return null;
  const text = rowText(raw);
  if (!text) return null;
  return { index, text, path: rowPath(raw) };
}

/** Drop a selected row that no longer has copyable text. Never call this from React render. */
export function discardEmptyPaneRow(model: PaneModel): boolean {
  if (paneRow() === null || rowBarContent(model)) return false;
  setPaneRow(null);
  return true;
}

export function openRow(index: number): void {
  const model = paneModel();
  const raw = model.texts[index];
  const text = raw === undefined ? "" : rowText(raw);
  if (!text) {
    if (paneRow() !== null) {
      setPaneRow(null);
      commitView();
    }
    return;
  }
  setPaneRow(paneRow() === index ? null : index);
  haptic(6);
  commitView();
}

export function closeRow(): void {
  if (paneRow() === null) return;
  setPaneRow(null);
  commitView();
}

export async function copyRow(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showStatus(done);
  } catch {
    showError(t("err.copyDenied"));
  }
  setPaneRow(null);
  commitView();
}

export function quoteRow(text: string): void {
  insertCompose(text);
  setPaneRow(null);
  commitView();
}

/**
 * Anchor the bubble above the picked row, or below it when the row is too
 * close to the top of the buffer. It floats over the terminal, so opening it
 * never moves a line; a row scrolled out of sight hides it until it returns.
 */
export function placeRowBubble(bubble: HTMLElement, index: number): void {
  const stage = bubble.offsetParent ?? bubble.parentElement;
  const term = termElement();
  const row = term?.querySelector<HTMLElement>(`.term-line[data-row="${index}"]`);
  if (!stage || !term || !row) {
    bubble.dataset.offscreen = "";
    return;
  }
  const origin = stage.getBoundingClientRect();
  const view = term.getBoundingClientRect();
  const line = row.getBoundingClientRect();
  if (line.bottom <= view.top || line.top >= view.bottom) {
    bubble.dataset.offscreen = "";
    return;
  }
  delete bubble.dataset.offscreen;
  const height = bubble.offsetHeight;
  const above = line.top - BUBBLE_GAP_PX - height >= view.top;
  const top = above ? line.top - origin.top - BUBBLE_GAP_PX - height : line.bottom - origin.top + BUBBLE_GAP_PX;
  bubble.dataset.side = above ? "above" : "below";
  bubble.style.top = `${Math.round(top)}px`;
}

/**
 * Keep an open bubble on its row while output moves the buffer, and close it
 * on a tap anywhere outside the bubble and the terminal (terminal taps are the
 * row gesture's own business: another row, blank space, or the same row).
 */
export function bindRowBubble(bubble: HTMLElement, index: number): () => void {
  const doc = bubble.ownerDocument;
  const view = doc.defaultView ?? window;
  const term = termElement();
  const place = () => placeRowBubble(bubble, index);
  const onDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && (bubble.contains(target) || term?.contains(target))) return;
    closeRow();
  };
  term?.addEventListener("scroll", place, { passive: true });
  view.addEventListener("resize", place);
  doc.addEventListener("pointerdown", onDown, true);
  return () => {
    term?.removeEventListener("scroll", place);
    view.removeEventListener("resize", place);
    doc.removeEventListener("pointerdown", onDown, true);
  };
}
