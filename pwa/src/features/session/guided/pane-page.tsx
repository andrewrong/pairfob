import { useLayoutEffect, useRef, type FocusEvent, type ReactNode } from "react";

/** Matches `--ease-spring`; Web Animations cannot read a custom property. */
const SPRING = "cubic-bezier(0.2, 1.05, 0.35, 1)";
const HEIGHT_MS = 240;
/** iOS reports the keyboard inset over several frames; look again once it has settled. */
const KEYBOARD_SETTLE_MS = 320;

/** The sheet card's last laid-out height, kept current while any page is shown. */
const heights = new WeakMap<Element, number>();
const watched = new WeakSet<Element>();

function watch(card: HTMLElement): void {
  if (watched.has(card) || typeof ResizeObserver === "undefined") return;
  watched.add(card);
  new ResizeObserver(() => heights.set(card, card.getBoundingClientRect().height)).observe(card);
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One page of the pane sheet. When a page replaces another (push, pop, or a
 * form swapping in its full agent list) the card eases from the old page's
 * height to the new one instead of jumping. Only the sheet card animates; it
 * sits in the top layer, so nothing behind it is laid out again.
 *
 * A focused field is brought into view above the pinned footer once the soft
 * keyboard has finished sliding in.
 */
export function PanePage({ className = "", tall = false, children }: { className?: string; tall?: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = root.current?.closest<HTMLElement>("dialog > form");
    if (!card) return;
    const before = heights.get(card);
    const after = card.getBoundingClientRect().height;
    heights.set(card, after);
    watch(card);
    if (before === undefined || Math.abs(before - after) < 2 || reducedMotion() || typeof card.animate !== "function") return;
    card.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: HEIGHT_MS, easing: SPRING });
  }, []);
  const reveal = (event: FocusEvent) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    const show = () => { if (document.activeElement === field) field.scrollIntoView?.({ block: "nearest" }); };
    window.setTimeout(show, KEYBOARD_SETTLE_MS);
    window.visualViewport?.addEventListener("resize", show, { once: true });
  };
  return <div ref={root} className={["pane-page", tall && "is-tall", className].filter(Boolean).join(" ")} onFocus={reveal}>
    {children}
  </div>;
}
