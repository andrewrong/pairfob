/** Past this a press on an editable command is a drag, not a tap that opens its editor. */
export const COMMAND_DRAG_SLOP_PX = 8;
/** Resting on a page dot this long turns the page under a dragged command. */
export const COMMAND_DRAG_FLIP_MS = 420;

function contains(el: Element, x: number, y: number): boolean {
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Drag one of the reader's own commands across the command pad in edit mode.
 * A floating copy follows the finger (the source cell may leave the page when
 * a dot flips it); release over any pad cell reports that cell's index, and a
 * drag never also counts as the tap that opens the editor. `drop` must read
 * the pad's current state: it can run after this cell has unmounted.
 *
 * WebKit does not reliably keep a press out of its own gestures on
 * `touch-action` alone, so the press also cancels its native touchmoves; a
 * pan that won would end the drag with pointercancel.
 */
export function bindCommandDrag(el: HTMLElement, drop: (to: number) => void): () => void {
  const doc = el.ownerDocument;
  const view = doc.defaultView!;
  let pointer: number | null = null;
  let origin = { x: 0, y: 0 };
  let ghost: HTMLElement | null = null;
  let offset = { x: 0, y: 0 };
  let pages: Element | null = null;
  let target: Element | null = null;
  let dot: Element | null = null;
  let flipTimer: number | null = null;
  let suppressClick = false;
  let bound = true;

  const mark = (next: Element | null) => {
    if (next === target) return;
    target?.classList.remove("is-drop-target");
    target = next;
    target?.classList.add("is-drop-target");
  };
  const hover = (x: number, y: number) => {
    const cells = pages ? [...pages.querySelectorAll("[data-pad-index]")] : [];
    mark(cells.find(cell => cell !== el && !cell.contains(el) && contains(cell, x, y)) ?? null);
    const dots = pages ? [...pages.querySelectorAll<HTMLElement>("[data-pad-dot]")] : [];
    const over = dots.find(candidate => contains(candidate, x, y)) ?? null;
    if (over === dot) return;
    dot = over;
    if (flipTimer !== null) view.clearTimeout(flipTimer);
    flipTimer = null;
    if (over && over.getAttribute("aria-current") !== "page") {
      flipTimer = view.setTimeout(() => { flipTimer = null; over.click(); }, COMMAND_DRAG_FLIP_MS);
    }
  };
  const lift = () => {
    pages = el.closest(".pad-pages");
    const rect = el.getBoundingClientRect();
    offset = { x: origin.x - rect.left, y: origin.y - rect.top };
    ghost = el.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.classList.add("pad-drag-ghost");
    Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, left: "0px", top: "0px" });
    doc.body.append(ghost);
    el.classList.add("is-drag-source");
  };
  // `translate`, not `transform`: the ghost's `scale` would scale the offset
  // too and leave it tens of pixels from a finger low on the screen.
  const place = (x: number, y: number) => {
    if (ghost) ghost.style.translate = `${x - offset.x}px ${y - offset.y}px`;
  };
  const finish = (dropped: boolean) => {
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("pointercancel", cancel, true);
    if (flipTimer !== null) view.clearTimeout(flipTimer);
    flipTimer = null;
    const index = target ? Number((target as HTMLElement).dataset.padIndex) : NaN;
    mark(null);
    dot = null;
    const dragged = ghost !== null;
    ghost?.remove();
    ghost = null;
    el.classList.remove("is-drag-source");
    pointer = null;
    pages = null;
    if (!bound) el.removeEventListener("touchmove", hold);
    if (dragged) suppressClick = true;
    if (dragged && dropped && Number.isFinite(index)) drop(index);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (!ghost) {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= COMMAND_DRAG_SLOP_PX) return;
      lift();
    }
    event.preventDefault();
    place(event.clientX, event.clientY);
    hover(event.clientX, event.clientY);
  };
  const up = (event: PointerEvent) => { if (event.pointerId === pointer) finish(true); };
  const cancel = (event: PointerEvent) => { if (event.pointerId === pointer) finish(false); };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || pointer !== null) return;
    pointer = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    suppressClick = false;
    doc.addEventListener("pointermove", move, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", cancel, true);
  };
  const hold = (event: TouchEvent) => {
    if (pointer !== null && event.cancelable) event.preventDefault();
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("touchmove", hold, { passive: false });
  el.addEventListener("click", click, true);
  return () => {
    // A lifted command outlives its cell: turning the page unmounts the source,
    // and the drop still belongs to the finger that is carrying it.
    // Its touches keep targeting the unmounted source, so the touchmove guard
    // stays until that finger lets go.
    bound = false;
    if (pointer !== null && !ghost) finish(false);
    el.removeEventListener("pointerdown", down);
    if (pointer === null) el.removeEventListener("touchmove", hold);
    el.removeEventListener("click", click, true);
  };
}
