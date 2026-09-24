import { useSyncExternalStore } from "react";

/**
 * The settled soft-keyboard state that app/viewport publishes as
 * `html[data-kb]`. Read from the attribute so the pad follows the same settled
 * value the dock animations use, never an intermediate inset mid-slide.
 */
export function softKeyboardOpen(doc: Document = document): boolean {
  return doc.documentElement.dataset.kb === "open";
}

export function subscribeSoftKeyboard(onStoreChange: () => void, doc: Document = document): () => void {
  const view = doc.defaultView;
  if (!view?.MutationObserver) return () => undefined;
  const observer = new view.MutationObserver(onStoreChange);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-kb"] });
  return () => observer.disconnect();
}

export function useSoftKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribeSoftKeyboard, softKeyboardOpen, () => false);
}

/**
 * The pad and the soft keyboard are never on screen together: asking for the
 * pad while typing first puts the keyboard away. Blurring the focused field is
 * the only way a page can close it.
 */
export function dismissSoftKeyboard(doc: Document = document): void {
  const active = doc.activeElement;
  if (active instanceof doc.defaultView!.HTMLElement && active.matches("input, textarea, [contenteditable='true']")) active.blur();
}
