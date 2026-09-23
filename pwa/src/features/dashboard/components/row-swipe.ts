/**
 * Swipe-left on a list row reveals its trailing actions.
 *
 * Horizontal travel only: a vertical drag stays a scroll and a hold stays the
 * object menu (the long-press binding cancels itself once the finger moves). A
 * swipe that moved swallows the click it would otherwise produce, so revealing
 * the actions never opens the session. Tapping anywhere outside an open row, or
 * swiping it back, closes it.
 */
const START_PX = 10;
const OPEN_RATIO = 0.4;

export type RowSwipe = { close(): void; destroy(): void };

export function bindRowSwipe(
  row: HTMLElement,
  slide: HTMLElement,
  actionsWidth: () => number,
  onChange: (open: boolean) => void,
): RowSwipe {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let startX = 0;
  let startY = 0;
  let base = 0;
  let dx = 0;
  let tracking = false;
  let horizontal = false;
  let moved = false;
  let open = false;
  let pointerId: number | null = null;

  const place = (x: number, animate: boolean) => {
    slide.style.transition = animate ? "" : "none";
    slide.style.transform = x ? `translateX(${x}px)` : "";
  };
  const settle = (next: boolean) => {
    open = next;
    row.classList.toggle("swiped", next);
    place(next ? -actionsWidth() : 0, true);
    onChange(next);
  };

  slide.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    tracking = true;
    horizontal = false;
    moved = false;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    base = open ? -actionsWidth() : 0;
    dx = base;
  }, { signal });

  slide.addEventListener("pointermove", (event) => {
    if (!tracking || event.pointerId !== pointerId) return;
    const x = event.clientX - startX;
    const y = event.clientY - startY;
    if (!horizontal) {
      if (Math.abs(x) < START_PX && Math.abs(y) < START_PX) return;
      if (Math.abs(y) >= Math.abs(x)) { tracking = false; return; }
      horizontal = true;
      moved = true;
      slide.setPointerCapture?.(event.pointerId);
    }
    const limit = actionsWidth();
    dx = Math.max(-limit - 24, Math.min(0, base + x));
    place(dx, false);
  }, { signal });

  const finish = () => {
    if (!tracking) return;
    tracking = false;
    if (!horizontal) return;
    settle(dx < -actionsWidth() * OPEN_RATIO);
  };
  slide.addEventListener("pointerup", finish, { signal });
  slide.addEventListener("pointercancel", () => { if (tracking && horizontal) settle(open); tracking = false; }, { signal });

  // A drag is not a tap, and a tap on an open row only closes it.
  slide.addEventListener("click", (event) => {
    if (!moved && !open) return;
    moved = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (open) settle(false);
  }, { capture: true, signal });

  row.ownerDocument.addEventListener("pointerdown", (event) => {
    if (open && !row.contains(event.target as Node)) settle(false);
  }, { capture: true, signal });

  return {
    close: () => { if (open) settle(false); },
    destroy: () => { lifetime.abort(); place(0, false); },
  };
}
