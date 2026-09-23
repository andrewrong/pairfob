/**
 * Board canvas gesture adapter.
 *
 * Owns the whole pointer lifetime of the board canvas: capture, the slop that
 * separates a tap from a drag, pan vs pane-scroll vs two-finger pinch, wheel
 * zoom and remote scroll, the tap synthesis that a prevented gesture still
 * owes the tile, and the click suppression that keeps a finished drag from
 * reopening a pane. Everything stateful lives in `BoardCanvasPorts`, so this
 * module is independent of the application store implementation, and
 * disposing it retires every listener, frame and in-flight gesture.
 */
import type { TabLayout } from "../../../lib/layout";
import { boardDragMode, boardScrollLines, BOARD_GESTURE_SLOP_PX } from "../model/gesture";
import { panCamera, type BoardCamera } from "../model/camera";
import { applyCameraTransform, fitCameraToViewport, zoomCameraAtPoint } from "./transform";

export type BoardCanvasPorts = {
  readCamera(): BoardCamera;
  writeCamera(camera: BoardCamera): void;
  /**
   * Remote scroll of one pane in the bound layout. Resolves true when the
   * daemon applied it, which is what earns a fresh thumbnail.
   */
  scrollPane(
    layout: TabLayout,
    paneId: string,
    direction: "up" | "down",
    lines: number,
  ): Promise<boolean> | boolean;
  requestPanePreview(paneId: string): void;
  openPane(paneId: string, tile?: HTMLElement): void;
  openMenu?(paneId: string, point: { x: number; y: number }, tile: HTMLElement): void;
};

export const BOARD_LONG_PRESS_MS = 500;

const WHEEL_ZOOM_FACTOR = 1.08;

function paneIdFromEvent(event: Event): string {
  const node = event.target instanceof Element ? event.target.closest(".board-pane") : null;
  return node instanceof HTMLElement ? node.dataset.paneId || "" : "";
}

export function bindBoardCanvasGestures(
  viewport: HTMLElement,
  stage: HTMLElement,
  layout: TabLayout,
  ports: BoardCanvasPorts,
): () => void {
  let retired = false;
  applyCameraTransform(stage, ports.readCamera());
  const frame = requestAnimationFrame(() => {
    if (retired || !viewport.isConnected) return;
    // First open fits the whole tab so every pane cell is on screen.
    if (ports.readCamera().fitted) return;
    const fitted = fitCameraToViewport(viewport, layout);
    ports.writeCamera(fitted);
    applyCameraTransform(stage, fitted);
  });

  const pointers = new Map<number, { x: number; y: number }>();
  let origin = { x: 0, y: 0 };
  let hitPane = "";
  let mode: "undecided" | "pan" | "scroll" | "pinch" = "undecided";
  let moved = false;
  let pinch = 0;
  let scrollRemainder = 0;
  let held = false;
  let syntheticClick = false;
  let longPress: ReturnType<typeof setTimeout> | undefined;
  const cancelLongPress = () => { clearTimeout(longPress); longPress = undefined; };

  const point = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });

  function writeCamera(camera: BoardCamera): void {
    ports.writeCamera(camera);
    applyCameraTransform(stage, camera);
  }

  function zoomAt(clientX: number, clientY: number, nextScale: number): void {
    const next = zoomCameraAtPoint(ports.readCamera(), viewport, clientX, clientY, nextScale);
    if (next) writeCamera(next);
  }

  function scrollPane(paneId: string, direction: "up" | "down", lines: number): void {
    if (!paneId || lines < 1) return;
    void Promise.resolve(ports.scrollPane(layout, paneId, direction, lines)).then(
      (applied) => {
        if (applied && !retired) ports.requestPanePreview(paneId);
      },
      () => undefined,
    );
  }

  const onDown = (event: PointerEvent) => {
    if (retired) return;
    if (event.button === 2) { held = false; moved = false; cancelLongPress(); return; }
    if (event.button !== 0) return;
    if (!pointers.size && event.target instanceof Element && event.target.closest(".board-pane-more")) {
      cancelLongPress(); held = false; moved = false; return;
    }
    cancelLongPress();
    if (held && pointers.size) return;
    held = false;
    const next = point(event);
    pointers.set(event.pointerId, next);
    origin = next;
    hitPane = paneIdFromEvent(event);
    moved = false;
    mode = "undecided";
    scrollRemainder = 0;
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom/happy-dom may not implement capture */
    }
    if (pointers.size >= 2) {
      moved = true;
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      mode = "pinch";
      hitPane = "";
    }
    if (pointers.size === 1 && hitPane && ports.openMenu && event.pointerType !== "mouse") {
      const tile = (event.target as Element).closest<HTMLElement>(".board-pane");
      if (tile) longPress = setTimeout(() => {
        if (retired || moved || pointers.size !== 1 || !tile.isConnected) return;
        held = true;
        moved = true;
        ports.openMenu!(hitPane, origin, tile);
      }, BOARD_LONG_PRESS_MS);
    }
    if (event.pointerType === "touch" || event.pointerType === "pen") event.preventDefault();
  };

  const onMove = (event: PointerEvent) => {
    if (retired || held || !pointers.has(event.pointerId)) return;
    const prev = pointers.get(event.pointerId)!;
    const next = point(event);
    pointers.set(event.pointerId, next);
    if (pointers.size === 2) {
      mode = "pinch";
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && dist > 0) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, ports.readCamera().scale * (dist / pinch));
        pinch = dist;
        moved = true;
      }
      event.preventDefault();
      return;
    }
    const fromOriginX = next.x - origin.x;
    const fromOriginY = next.y - origin.y;
    if (mode === "undecided") {
      if (Math.hypot(fromOriginX, fromOriginY) < BOARD_GESTURE_SLOP_PX) return;
      cancelLongPress();
      mode = boardDragMode(fromOriginX, fromOriginY, hitPane);
      moved = true;
      event.preventDefault();
      if (mode === "pan") {
        writeCamera(panCamera(ports.readCamera(), fromOriginX, fromOriginY));
      } else {
        const stepped = boardScrollLines(0, fromOriginY);
        scrollRemainder = stepped.remainder;
        if (stepped.lines) scrollPane(hitPane, stepped.direction, stepped.lines);
      }
      return;
    }
    if (mode === "pan") {
      moved = true;
      event.preventDefault();
      writeCamera(panCamera(ports.readCamera(), next.x - prev.x, next.y - prev.y));
      return;
    }
    if (mode !== "scroll") return;
    moved = true;
    event.preventDefault();
    const stepped = boardScrollLines(scrollRemainder, next.y - prev.y);
    scrollRemainder = stepped.remainder;
    if (stepped.lines) scrollPane(hitPane, stepped.direction, stepped.lines);
  };

  const end = (event: PointerEvent) => {
    if (retired || !pointers.has(event.pointerId)) return;
    cancelLongPress();
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (pointers.size === 0) {
      // A gesture that never moved is a tap: hand it to the tile it started on.
      if (!moved && !held && hitPane) {
        for (const tile of viewport.querySelectorAll<HTMLButtonElement>(".board-pane")) {
          if (tile.dataset.paneId !== hitPane) continue;
          syntheticClick = true;
          (tile.querySelector<HTMLElement>(".board-pane-open") ?? tile).click();
          syntheticClick = false;
          moved = true;
          break;
        }
      }
      if (mode === "scroll" && hitPane) ports.requestPanePreview(hitPane);
      mode = "undecided";
    }
    if (moved) event.preventDefault();
  };

  const cancel = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    cancelLongPress();
    pointers.clear();
    hitPane = "";
    moved = true;
    mode = "undecided";
    pinch = 0;
  };

  const onWheel = (event: WheelEvent) => {
    if (retired) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, ports.readCamera().scale * wheelFactor(event.deltaY));
      return;
    }
    const paneId = paneIdFromEvent(event);
    if (paneId) {
      event.preventDefault();
      const stepped = boardScrollLines(scrollRemainder, -event.deltaY);
      scrollRemainder = stepped.remainder;
      if (stepped.lines) scrollPane(paneId, stepped.direction, stepped.lines);
      return;
    }
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, ports.readCamera().scale * wheelFactor(event.deltaY));
  };

  const onClick = (event: MouseEvent) => {
    if (retired || syntheticClick || !moved || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onContextMenu = (event: MouseEvent) => {
    const paneId = paneIdFromEvent(event);
    const tile = event.target instanceof Element ? event.target.closest<HTMLElement>(".board-pane") : null;
    if (!paneId || !tile || !ports.openMenu) return;
    event.preventDefault();
    event.stopPropagation();
    cancelLongPress();
    if (held || (pointers.size && moved)) return;
    held = true;
    moved = true;
    const rect = tile.getBoundingClientRect();
    ports.openMenu(paneId, event.clientX || event.clientY ? point(event as PointerEvent)
      : { x: rect.right - 12, y: rect.top + 32 }, tile);
  };

  viewport.addEventListener("pointerdown", onDown, { capture: true, passive: false });
  viewport.addEventListener("pointermove", onMove, { capture: true, passive: false });
  viewport.addEventListener("pointerup", end, true);
  viewport.addEventListener("pointercancel", cancel, true);
  viewport.addEventListener("lostpointercapture", cancel, true);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("click", onClick, true);
  viewport.addEventListener("contextmenu", onContextMenu, true);

  return () => {
    retired = true;
    cancelLongPress();
    for (const id of pointers.keys()) {
      if (viewport.hasPointerCapture?.(id)) viewport.releasePointerCapture(id);
    }
    pointers.clear();
    cancelAnimationFrame(frame);
    viewport.removeEventListener("pointerdown", onDown, true);
    viewport.removeEventListener("pointermove", onMove, true);
    viewport.removeEventListener("pointerup", end, true);
    viewport.removeEventListener("pointercancel", cancel, true);
    viewport.removeEventListener("lostpointercapture", cancel, true);
    viewport.removeEventListener("wheel", onWheel);
    viewport.removeEventListener("click", onClick, true);
    viewport.removeEventListener("contextmenu", onContextMenu, true);
  };
}

function wheelFactor(deltaY: number): number {
  return deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
}
