export const PAD_HOLD_EVENT = "pairfob:pad-hold";
export const REPEAT_DELAY_MS = 380;
export const REPEAT_EVERY_MS = 90;

type KeyPressOptions = {
  repeat?: boolean;
  release?: (cancelled: boolean) => void;
};

export type PadPressBinding = { stop: () => void; destroy: () => void };

/** One physical press owns its repeats and release; clicks only add keyboard/AT activation. */
export function bindPadPress(
  element: HTMLElement,
  press: () => void,
  options: KeyPressOptions = {},
): PadPressBinding {
  const doc = element.ownerDocument;
  const view = doc.defaultView!;
  let pointer: number | null = null;
  let timer: number | null = null;
  let pending = false;
  let origin: { x: number; y: number } | null = null;

  const disabled = () => element.matches(":disabled, [aria-disabled='true']");
  const finish = (cancelled: boolean) => {
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
    element.classList.remove("is-pressed");
    doc.removeEventListener("pointermove", onPointerMove, true);
    doc.removeEventListener("pointerup", end, true);
    doc.removeEventListener("pointercancel", cancel, true);
    doc.removeEventListener("visibilitychange", visibility);
    view.removeEventListener("blur", stop);
    if (pointer === null) return;
    pointer = null;
    const deliver = pending && !cancelled;
    pending = false;
    origin = null;
    if (deliver) press();
    options.release?.(cancelled);
  };
  const stop = () => finish(true);
  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    const moved = origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10;
    finish(!element.isConnected || disabled() || Boolean(moved));
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === pointer) stop();
  };
  const visibility = () => {
    if (doc.hidden) stop();
  };
  const repeat = () => {
    if (!element.isConnected || disabled() || doc.hidden) {
      stop();
      return;
    }
    press();
    if (pointer !== null) timer = view.setTimeout(repeat, REPEAT_EVERY_MS);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || disabled()) return;
    // Keep the current textarea, selection and mobile keyboard in place.
    event.preventDefault();
    if (pointer !== null) return;
    pointer = event.pointerId;
    element.classList.add("is-pressed");
    // Track even outside the key: touch pointers may be implicitly captured.
    doc.addEventListener("pointermove", onPointerMove, true);
    doc.addEventListener("pointerup", end, true);
    doc.addEventListener("pointercancel", cancel, true);
    doc.addEventListener("visibilitychange", visibility);
    view.addEventListener("blur", stop);
    const pageableTouch = event.pointerType === "touch" && element.closest(".pad-page") !== null;
    origin = pageableTouch ? { x: event.clientX, y: event.clientY } : null;
    // Modifiers may activate immediately: cancelled drags release without latching.
    // Sending keys waits until a tap ends or a stationary repeat hold is established.
    pending = pageableTouch && !options.release;
    if (pending) {
      if (options.repeat) timer = view.setTimeout(() => {
        if (!element.isConnected || disabled() || doc.hidden) { stop(); return; }
        pending = false;
        element.dispatchEvent(new view.CustomEvent(PAD_HOLD_EVENT, { bubbles: true, detail: pointer }));
        press();
        if (pointer !== null) timer = view.setTimeout(repeat, REPEAT_EVERY_MS);
      }, REPEAT_DELAY_MS);
    } else {
      press();
      if (options.repeat && pointer !== null) timer = view.setTimeout(repeat, REPEAT_DELAY_MS + REPEAT_EVERY_MS);
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
      stop();
      return;
    }
    const rect = element.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) stop();
  };
  const onClick = (event: MouseEvent) => {
    // Pointer-generated clicks belong to the handled pointer gesture,
    // including PointerEvents whose detail is zero. No time-based debounce:
    // separate rapid taps and keyboard/assistive activation remain independent.
    if (pointer !== null || event.detail !== 0 || ("pointerType" in event && event.pointerType) || disabled()) return;
    event.preventDefault();
    press();
    options.release?.(false);
  };

  element.addEventListener("pointerdown", onPointerDown);
  for (const type of ["pointerleave", "lostpointercapture"] as const) {
    element.addEventListener(type, cancel);
  }
  element.addEventListener("click", onClick);
  return {
    stop,
    destroy() {
      stop();
      element.removeEventListener("pointerdown", onPointerDown);
      for (const type of ["pointerleave", "lostpointercapture"] as const) {
        element.removeEventListener(type, cancel);
      }
      element.removeEventListener("click", onClick);
    },
  };
}
