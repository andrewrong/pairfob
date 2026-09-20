import type { AgentTraceViewport } from "../../../lib/agent-trace-cache";

const MAX_SCROLL_PX = 10_000_000;

function bounded(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_SCROLL_PX, Math.min(MAX_SCROLL_PX, value));
}

function anchorNodes(stream: HTMLElement): HTMLElement[] {
  return [...stream.querySelectorAll<HTMLElement>("[data-trace-anchor]")];
}

function relativeTop(stream: HTMLElement, node: HTMLElement): number {
  const streamRect = stream.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  if (streamRect.height || nodeRect.height || nodeRect.top || streamRect.top) return nodeRect.top - streamRect.top;
  return node.offsetTop - stream.scrollTop;
}

/** Capture plain, bounded viewport data. No DOM node escapes into the trace cache. */
export function captureTraceViewport(
  stream: HTMLElement,
  follow: boolean,
  unread: boolean,
): AgentTraceViewport {
  const nodes = anchorNodes(stream);
  let anchor = "";
  let offset = 0;
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    const measurable = Boolean(rect.height || rect.top || stream.getBoundingClientRect().height || node.offsetHeight || node.offsetTop);
    if (!measurable) continue;
    const top = relativeTop(stream, node);
    const height = rect.height || node.offsetHeight;
    if (top + height > 0 || node === nodes[nodes.length - 1]) {
      anchor = node.dataset.traceAnchor || "";
      offset = bounded(top);
      break;
    }
  }
  return {
    anchor: anchor.slice(0, 512),
    offset,
    scrollTop: bounded(stream.scrollTop),
    follow,
    unread,
  };
}

/** Restore an anchor after React has committed changed/prepended transcript content. */
export function restoreTraceViewport(stream: HTMLElement, viewport: AgentTraceViewport): boolean {
  if (viewport.follow) {
    stream.scrollTop = stream.scrollHeight;
    return true;
  }
  const anchor = viewport.anchor
    ? anchorNodes(stream).find((node) => node.dataset.traceAnchor === viewport.anchor)
    : undefined;
  if (!anchor) {
    stream.scrollTop = bounded(viewport.scrollTop);
    return false;
  }
  stream.scrollTop = bounded(stream.scrollTop + relativeTop(stream, anchor) - viewport.offset);
  return true;
}
