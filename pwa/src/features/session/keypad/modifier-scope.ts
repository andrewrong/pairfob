import { useLayoutEffect } from "react";
import { navigationStore, currentScreen } from "../../../app/navigation-store";
import { computersStore, liveSession } from "../../computers/catalog-store";
import { sessionStore, openPaneId, isFullTerminal, isAgentChat } from "../session-store";
import { clearModifiers } from "./keypad";

/** A modifier lock belongs to one visible keypad on one live pane. */
export function bindModifierScope(doc: Document): () => void {
  const identity = () => [liveSession(), openPaneId(), currentScreen(), isFullTerminal(), isAgentChat()];
  let owner = identity();
  const check = () => {
    const next = identity();
    if (next.some((value, index) => value !== owner[index])) {
      owner = next;
      clearModifiers();
    }
  };
  const unsubscribers = [sessionStore, computersStore, navigationStore].map(store => store.subscribe(check));
  const hidden = () => { if (doc.hidden) clearModifiers(); };
  doc.addEventListener("visibilitychange", hidden);
  doc.defaultView?.addEventListener("blur", clearModifiers);
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    doc.removeEventListener("visibilitychange", hidden);
    doc.defaultView?.removeEventListener("blur", clearModifiers);
    clearModifiers();
  };
}

export function useModifierScope(): void {
  useLayoutEffect(() => bindModifierScope(document), []);
}
