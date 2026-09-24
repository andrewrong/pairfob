import { useLayoutEffect } from "react";

/**
 * Window scroll memory for a page that scrolls the document.
 *
 * The phone tab roots (sessions, settings) share one window scroller, so moving
 * to another tab or into a session and back used to land at whatever offset
 * the other page left. Each page keeps its own offset under a key: it is
 * recorded while the page is mounted and restored when it mounts again.
 */
const positions = new Map<string, number>();

export function useRememberedScroll(key: string, enabled = true): void {
  useLayoutEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    window.scrollTo(0, positions.get(key) ?? 0);
    const record = () => { positions.set(key, window.scrollY); };
    window.addEventListener("scroll", record, { passive: true });
    return () => window.removeEventListener("scroll", record);
  }, [key, enabled]);
}

/** The offset a page will return to, so it can lay out for it before the first paint. */
export function rememberedScroll(key: string): number {
  return positions.get(key) ?? 0;
}
