import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../../shared/ui/primitives/button";
import { ModalFrame, presentModal, type ModalController } from "../../../../shared/ui/overlay/modal";
import { haptic } from "../../../../lib/dom";
import { attachT } from "../attach-copy";
import {
  canUndo,
  commitArrow,
  createDoc,
  placeEllipse,
  placeMarker,
  placeText,
  resetDoc,
  setCrop,
  undo,
  type EditorDoc,
  type EditorTool,
  type Point,
  exportPlan,
} from "./image-model";
import {
  canvasToBlob,
  defaultCanvasFactory,
  editedFileName,
  paintPreview,
  previewGeometry,
  renderExport,
  screenToImage,
  type LoadedImage,
} from "./image-render";

const TOOLS: ReadonlyArray<{ id: EditorTool; copy: Parameters<typeof attachT>[0] }> = [
  { id: "cropRect", copy: "editor.cropRect" },
  { id: "ellipse", copy: "editor.ellipse" },
  { id: "arrow", copy: "editor.arrow" },
  { id: "text", copy: "editor.text" },
  { id: "marker", copy: "editor.marker" },
];

/**
 * Viewport space reserved for the modal chrome around the preview (head,
 * tool rows, optional text field, hint, two action rows, paddings). The
 * preview height is capped to this remainder so tall portraits still leave
 * every control reachable without scrolling on a phone.
 */
const PREVIEW_RESERVED_PX = 360;
const PREVIEW_MIN_HEIGHT = 160;

export type ImageEditorInput = {
  name: string;
  image: LoadedImage;
  /** Null when applied; otherwise a user-facing reason the edit was rejected. */
  onApply: (file: File) => Promise<string | null>;
  onClose: () => void;
};

type Drag = { tool: Exclude<EditorTool, "text" | "marker">; from: Point; to: Point };
type Box = { width: number; height: number };

/**
 * Fit the decoded image, preserving aspect ratio, into the frame's measured
 * content width and the viewport-derived available height. Both dimensions are
 * always computed together: CSS never shrinks one side on its own, which was
 * distorting previews when max-width constrained only the width.
 */
function fitBox(availableWidth: number, availableHeight: number, image: { width: number; height: number }): Box {
  const maxWidth = Math.max(120, availableWidth);
  const maxHeight = Math.max(PREVIEW_MIN_HEIGHT, availableHeight);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

function availablePreviewHeight(): number {
  const viewport = globalThis.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  return height - PREVIEW_RESERVED_PX;
}

function ImageEditorBody({ modal, input }: { modal: ModalController<unknown>; input: ImageEditorInput }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const doc0 = useMemo(() => createDoc(input.image.width, input.image.height), [input.image]);
  const [doc, setDocState] = useState<EditorDoc>(doc0);
  const [tool, setToolState] = useState<EditorTool>("arrow");
  const [box, setBox] = useState<Box>({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [errorLine, setErrorLine] = useState("");
  const docRef = useRef(doc);
  const toolRef = useRef(tool);
  const dragRef = useRef<Drag | null>(null);
  const boxRef = useRef(box);
  boxRef.current = box;

  function setDoc(next: EditorDoc): void {
    docRef.current = next;
    setDocState(next);
  }

  function setTool(next: EditorTool): void {
    toolRef.current = next;
    setToolState(next);
  }

  // Measure the actual laid-out frame after the modal opens and on every
  // container/viewport resize, then size both canvas dimensions together.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = (observedWidth?: number) => {
      const measured = observedWidth ?? frame.clientWidth;
      // A real frame is laid out by the time the modal opens. A zero reading
      // means the host does not perform layout (headless tests), so fall back
      // to a phone-width box instead of rendering nothing.
      const width = measured > 0 ? measured : 320;
      setBox((current) => {
        const next = fitBox(width, availablePreviewHeight(), input.image);
        return current.width === next.width && current.height === next.height ? current : next;
      });
    };
    measure();
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) measure(width);
    });
    observer.observe(frame);
    const onViewportResize = () => measure();
    window.addEventListener("resize", onViewportResize);
    globalThis.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onViewportResize);
      globalThis.visualViewport?.removeEventListener("resize", onViewportResize);
    };
  }, [input.image]);

  function paint(): void {
    const canvas = canvasRef.current;
    const currentBox = boxRef.current;
    if (!canvas || currentBox.width <= 0) return;
    const dpr = Math.min(2, canvas.ownerDocument.defaultView?.devicePixelRatio || 1);
    const backingW = Math.round(currentBox.width * dpr);
    const backingH = Math.round(currentBox.height * dpr);
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW;
      canvas.height = backingH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const geometry = previewGeometry(backingW, backingH, docRef.current);
    const drag = dragRef.current;
    paintPreview(
      ctx,
      input.image.source,
      docRef.current,
      geometry,
      drag && (drag.tool === "arrow" || drag.tool === "cropRect" || drag.tool === "ellipse")
        ? { kind: drag.tool, from: drag.from, to: drag.to }
        : null,
    );
  }

  useLayoutEffect(paint, [doc, box, input.image.source]);

  // Native pointer listeners: canvas gestures need capture semantics without
  // going through React's event delegation, and they work with touch + mouse.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.width <= 0) return;

    function imagePoint(event: PointerEvent): Point {
      const rect = canvas!.getBoundingClientRect();
      const backingX = ((event.clientX - rect.left) / (rect.width || box.width)) * canvas!.width;
      const backingY = ((event.clientY - rect.top) / (rect.height || box.height)) * canvas!.height;
      return screenToImage({ x: backingX, y: backingY }, previewGeometry(canvas!.width, canvas!.height, docRef.current));
    }

    function onPointerDown(event: PointerEvent): void {
      if (busy) return;
      event.preventDefault();
      try {
        canvas!.setPointerCapture(event.pointerId);
      } catch {
        // Some test environments lack active-pointer state; capture is optional.
      }
      const point = imagePoint(event);
      const activeTool = toolRef.current;
      if (activeTool === "marker") {
        setDoc(placeMarker(docRef.current, point));
        haptic(4);
        return;
      }
      if (activeTool === "text") {
        const text = textInputRef.current?.value ?? "";
        if (text.trim()) {
          setDoc(placeText(docRef.current, point, text));
          haptic(4);
        }
        return;
      }
      dragRef.current = { tool: activeTool, from: point, to: point };
    }

    function onPointerMove(event: PointerEvent): void {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      drag.to = imagePoint(event);
      paint();
    }

    function finishDrag(): void {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      const current = docRef.current;
      if (drag.tool === "arrow") {
        setDoc(commitArrow(current, drag.from, drag.to));
      } else if (drag.tool === "ellipse") {
        setDoc(placeEllipse(current, drag.from, drag.to));
      } else {
        setDoc(setCrop(current, drag.from, drag.to));
      }
      haptic(4);
    }

    function onPointerUp(): void {
      finishDrag();
    }

    // A system gesture (scroll, notification shade, palm) cancels the pointer:
    // discard the half-drawn shape entirely. It must never be committed.
    function onPointerCancel(): void {
      if (!dragRef.current) return;
      dragRef.current = null;
      paint();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [box.width, box.height, busy]);

  useLayoutEffect(() => () => input.onClose(), [input]);

  async function apply(): Promise<void> {
    if (busy || !canUndo(docRef.current)) return;
    setBusy(true);
    setErrorLine("");
    try {
      const plan = exportPlan(docRef.current);
      const canvas = defaultCanvasFactory(plan.width, plan.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no-2d-context");
      renderExport(ctx, input.image.source, docRef.current, plan);
      const blob = await canvasToBlob(canvas);
      const file = new File([blob], editedFileName(input.name), { type: "image/png" });
      // Includes the size-limit rejection: the sheet notice lives behind this
      // modal, so the reason is surfaced here and the original is preserved.
      const reason = await input.onApply(file);
      if (reason === null) { modal.close(null); return; }
      setErrorLine(reason);
      haptic(2);
    } catch {
      setErrorLine(attachT("editor.exportFailed"));
      haptic(2);
    } finally {
      setBusy(false);
    }
  }

  return <div className="imgedit">
    <div className="imgedit-tools" role="toolbar" aria-label={attachT("editor.title")}>
      {TOOLS.map((entry) => (
        <Button
          key={entry.id}
          className={`imgedit-tool${tool === entry.id ? " on" : ""}`}
          aria-pressed={tool === entry.id}
          onClick={() => { setTool(entry.id); haptic(2); }}
        >{attachT(entry.copy)}</Button>
      ))}
    </div>
    {tool === "text" && <input
      ref={textInputRef}
      className="imgedit-text"
      maxLength={40}
      placeholder={attachT("editor.textPlaceholder")}
    />}
    <div ref={frameRef} className="imgedit-frame">
      {box.width > 0 && <canvas
        ref={canvasRef}
        className="imgedit-canvas"
        style={{ width: box.width, height: box.height, touchAction: "none" }}
      />}
    </div>
    <p className="imgedit-hint">{attachT("editor.hint")}</p>
    {errorLine && <p className="imgedit-error" role="alert" aria-live="assertive">{errorLine}</p>}
    <div className="imgedit-actions">
      <div className="imgedit-actions-secondary">
        <Button onClick={() => setDoc(undo(docRef.current))} disabled={!canUndo(doc)}>{attachT("editor.undo")}</Button>
        <Button onClick={() => setDoc(resetDoc(docRef.current))} disabled={!canUndo(doc)}>{attachT("editor.reset")}</Button>
        <Button onClick={() => modal.dismiss()}>{attachT("editor.cancel")}</Button>
      </div>
      <Button className="btn btn-primary imgedit-apply" disabled={busy || !canUndo(doc)} aria-busy={busy}
        onClick={() => void apply()}>{busy ? attachT("editor.busy") : attachT("editor.apply")}</Button>
    </div>
  </div>;
}

/** Present the editor over the sheet. Cancel leaves the original picked file. */
export function presentImageEditor(input: ImageEditorInput): void {
  presentModal((modal) => (
    <ModalFrame modal={modal} title={attachT("editor.title")} className="modal imgedit-modal">
      <ImageEditorBody modal={modal} input={input} />
    </ModalFrame>
  ));
}
