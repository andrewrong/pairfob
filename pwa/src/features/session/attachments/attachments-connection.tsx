/** In-sheet direct connection action; connecting never starts queue work. */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../../shared/ui/primitives/button";
import { connectionStore } from "../../connection/connection-store";
import { computersStore, liveSession } from "../../computers/catalog-store";
import { capabilitiesStore } from "../../operations/capabilities-store";
import { selectNetworkMode } from "../../settings/network-preference";
import { attachmentP2PReady, scopeMatches } from "./attachments-context";
import { attachT } from "./attach-copy";
import type { AttachmentScope } from "./attach-model";

export function useAttachmentP2PReady(): boolean {
  return useSyncExternalStore((listener) => {
    const subscriptions = [connectionStore.subscribe(listener), computersStore.subscribe(listener),
      capabilitiesStore.subscribe(listener), liveSession()?.onEvent?.(listener)];
    return () => subscriptions.forEach(unsubscribe => unsubscribe?.());
  }, attachmentP2PReady);
}

export function AttachmentConnection({ scope, current, ready }: {
  scope: AttachmentScope; current: boolean; ready: boolean;
}) {
  const connection = useSyncExternalStore(connectionStore.subscribe, connectionStore.get);
  const [attempt, setAttempt] = useState<"idle" | "connecting" | "failed" | "connected">("idle");
  const generation = useRef(0);
  const activeSession = liveSession();
  const pending = useRef<number | null>(null);
  useEffect(() => {
    setAttempt("idle");
    return () => { generation.current += 1; pending.current = null; };
  }, [scope.daemonId, scope.paneId, activeSession, current]);
  const connecting = attempt === "connecting" || connection.transportSwitching;

  async function connect() {
    if (pending.current !== null || connecting || !current || !scopeMatches(scope)) return;
    const session = liveSession();
    const token = ++generation.current;
    pending.current = token;
    setAttempt("connecting");
    try {
      // Reuses Settings' preference persistence, shared switch arbitration,
      // diagnostics and inactive-computer synchronization.
      await selectNetworkMode("p2p");
    } catch {
      // Settings normally reports a switch error; retain a local fallback.
    } finally {
      if (pending.current === token) pending.current = null;
      if (token === generation.current && liveSession() === session && scopeMatches(scope)) {
        setAttempt(attachmentP2PReady() ? "connected" : "failed");
      }
    }
  }

  if (!current) return null;
  if (ready) return attempt === "idle" ? null
    : <p className="attach-banner" role="status">{attachT("attach.p2pConnected")}</p>;
  return <div className="attach-banner">
    <p role="status">{attachT(connecting ? "attach.p2pConnecting"
      : !connection.p2pEnabled ? "attach.p2pUnavailable"
      : attempt === "failed" ? "attach.p2pFailed" : "attach.p2pRequired")}</p>
    <Button className="attach-act" disabled={connecting || !connection.p2pEnabled}
      onClick={() => void connect()}>{attachT(connecting ? "attach.p2pConnecting" : "attach.connectP2P")}</Button>
  </div>;
}
