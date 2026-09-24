import { COMPOSE_MIN_PX } from "./compose-store";
import { termFontPx, termLineHeightPx } from "../settings/preferences-store";

/**
 * How tall a compose field may grow (session page v2).
 *
 * The field grows with its draft instead of scrolling inside a four-line box,
 * but the terminal above it must stay readable: at most 40 % of the visual
 * viewport, and never so tall that fewer than six terminal rows remain under
 * the header and the rest of the dock. Four lines stay available whenever the
 * screen has room for them without pushing the terminal under three rows.
 */
export type ComposeRoom = {
  /** Visual viewport height (the keyboard already subtracted). */
  viewport: number;
  /** Session header height. */
  header: number;
  /** Everything in the dock except the field itself: keypad, tray, margins. */
  dockChrome: number;
  /** One terminal row. */
  termRow: number;
  /** One line of the field. */
  line: number;
  /** The field's vertical padding and borders. */
  frame: number;
};

export const COMPOSE_LINE_PX = 20.8;
export const COMPOSE_FRAME_PX = 22;
const TERMINAL_ROWS_KEPT = 6;
const TERMINAL_ROWS_FLOOR = 3;
const VIEWPORT_SHARE = 0.4;
const FLOOR_LINES = 4;

export function composeMaxPx(room: ComposeRoom): number {
  const free = room.viewport - room.header - room.dockChrome;
  const budget = Math.min(room.viewport * VIEWPORT_SHARE, free - TERMINAL_ROWS_KEPT * room.termRow);
  const floor = Math.min(room.frame + FLOOR_LINES * room.line, free - TERMINAL_ROWS_FLOOR * room.termRow);
  return Math.max(COMPOSE_MIN_PX, Math.floor(Math.max(budget, floor)));
}

function viewportHeight(doc: Document): number {
  // The viewport binding publishes the keyboard-adjusted height; before it runs
  // (tests, first paint) the window is the best answer.
  const published = Number.parseFloat(doc.documentElement.style.getPropertyValue("--vv-height"));
  if (Number.isFinite(published) && published > 0) return published;
  return doc.defaultView?.visualViewport?.height || doc.defaultView?.innerHeight || 0;
}

/** Measure the field's surroundings. Read before the field's own height is reset. */
export function measureComposeRoom(field: HTMLTextAreaElement): ComposeRoom {
  const doc = field.ownerDocument;
  const root = field.closest(".pane-root") ?? doc.body;
  const header = root.querySelector<HTMLElement>("header.chrome")?.offsetHeight ?? 0;
  const dock = field.closest<HTMLElement>(".dock, .full-terminal-pad");
  const dockChrome = dock ? Math.max(0, dock.offsetHeight - field.offsetHeight) : 0;
  const lineHeight = Number.parseFloat(doc.defaultView?.getComputedStyle(field).lineHeight ?? "");
  return {
    viewport: viewportHeight(doc),
    header,
    dockChrome,
    termRow: termLineHeightPx(termFontPx()),
    // A unitless computed value (some engines, tests) is a multiplier, not pixels.
    line: Number.isFinite(lineHeight) && lineHeight >= 8 ? lineHeight : COMPOSE_LINE_PX,
    frame: COMPOSE_FRAME_PX,
  };
}

/**
 * Size a compose textarea to its content within the room it has. Returns true
 * when the height changed, so the caller can keep its scroller pinned.
 */
export function fitComposeHeight(field: HTMLTextAreaElement): boolean {
  const before = field.style.height;
  const max = composeMaxPx(measureComposeRoom(field));
  field.style.maxHeight = `${max}px`;
  field.style.height = "auto";
  field.style.height = `${Math.min(Math.max(field.scrollHeight, COMPOSE_MIN_PX), max)}px`;
  return field.style.height !== before;
}

/** Logical lines in a draft, for the "N 行" hint. */
export function draftLineCount(draft: string): number {
  return draft ? draft.split("\n").length : 0;
}
