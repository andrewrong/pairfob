/**
 * Direct-connection step for attachments. Uploads need P2P; the tray's
 * "连接" and the send prompt's "连接" both go through `connectAttachmentP2P`,
 * which reuses Settings' network switch (preference persistence, switch
 * arbitration, diagnostics). Connecting never starts uploads by itself: the
 * tray's auto-start reacts to the connection once it is up.
 */
import { useSyncExternalStore } from "react";
import { connectionStore } from "../../connection/connection-store";
import { computersStore, liveSession } from "../../computers/catalog-store";
import { capabilitiesStore } from "../../operations/capabilities-store";
import { selectNetworkMode } from "../../settings/network-preference";
import { attachmentP2PReady, scopeMatches } from "./attachments-context";
import type { AttachmentScope } from "./attach-model";

export function subscribeAttachmentP2P(listener: () => void): () => void {
  const subscriptions = [connectionStore.subscribe(listener), computersStore.subscribe(listener),
    capabilitiesStore.subscribe(listener), liveSession()?.onEvent?.(listener)];
  return () => subscriptions.forEach(unsubscribe => unsubscribe?.());
}

export function useAttachmentP2PReady(): boolean {
  return useSyncExternalStore(subscribeAttachmentP2P, attachmentP2PReady);
}

/** Outcome of the last explicit attempt; "idle" until the reader asks. */
export type ConnectAttempt = "idle" | "connecting" | "failed";

let attempt: ConnectAttempt = "idle";
let pending: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function setAttempt(next: ConnectAttempt): void {
  if (attempt === next) return;
  attempt = next;
  for (const listener of listeners) listener();
}

export function connectAttempt(): ConnectAttempt {
  return attempt;
}

export function subscribeConnectAttempt(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Ask for a direct connection on behalf of `scope`. Concurrent taps share one
 * attempt. Resolves true when P2P is ready for the same live pane afterwards.
 */
export function connectAttachmentP2P(scope: AttachmentScope): Promise<boolean> {
  if (attachmentP2PReady()) return Promise.resolve(true);
  if (pending) return pending;
  if (!scopeMatches(scope) || connectionStore.get().transportSwitching) return Promise.resolve(false);
  const session = liveSession();
  setAttempt("connecting");
  pending = (async () => {
    try {
      await selectNetworkMode("p2p");
    } catch {
      // Settings reports a switch error itself; the tray keeps a local line.
    }
    const ok = attachmentP2PReady() && liveSession() === session && scopeMatches(scope);
    setAttempt(ok ? "idle" : "failed");
    return ok;
  })().finally(() => { pending = null; });
  return pending;
}

/** Test/teardown helper. */
export function resetAttachmentConnectAttempt(): void {
  pending = null;
  setAttempt("idle");
}
