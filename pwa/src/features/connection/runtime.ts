/**
 * Runtime observation: GetConfig and the follow-up snapshot/pane reads.
 *
 * Capabilities fail closed before the RPC and on a failed parse. A response
 * whose herd-config generation or live session no longer matches is dropped, so
 * a computer switch cannot install the previous daemon's grants.
 */
import { applyCapabilities, clearCapabilities } from "../operations/capabilities-store";
import { setCredential } from "../computers/catalog-store";
import { applyRuntimeIdentity, runtimeStore, setIdentityPending, setPushEnabled } from "./runtime-store";
import { noticesStore, clearNotice } from "../../app/notices-store";
import { batch } from "../../shared/model/domain-store";
import { FRIENDLY_ERROR } from "../../lib/notices";
import { parseRuntimeOperationsConfig } from "../../lib/operations";
import type { LiveSession, PairResult } from "../../lib/protocol/client";
import { herdConfigIsCurrent, nextHerdConfigRequest } from "./generations";

export type RuntimeObservationPorts = {
  acceptDaemonVersion(config: unknown): void;
  markDaemonConfigIncompatible(): void;
  saveCredential(pair: PairResult): Promise<void>;
  reloadComputers(): Promise<void>;
  refreshFromSession(): Promise<void>;
  commitView(): void;
  currentLive(): LiveSession | null;
  currentCredential(): PairResult | null;
};

/**
 * How long an unanswered first GetConfig reads as "still reading" before the
 * header falls back to "cannot confirm Herdr". A healthy computer answers in
 * well under a second; this covers a slow relay hop or a just-woken daemon.
 */
export const IDENTITY_READ_GRACE_MS = 8_000;

let identityTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A session's runtime identity is about to be read. Until it answers (or the
 * grace period runs out) an empty runtime kind means "not read yet". Called as
 * the session goes live, before the first paint of the list.
 */
export function beginIdentityRead(): void {
  if (identityTimer) clearTimeout(identityTimer);
  identityTimer = setTimeout(endIdentityRead, IDENTITY_READ_GRACE_MS);
  setIdentityPending(true);
}

export function endIdentityRead(): void {
  if (identityTimer) clearTimeout(identityTimer);
  identityTimer = null;
  setIdentityPending(false);
}

/** The accepted observation still owns the request, session and credential. */
function acceptedStillCurrent(request: number, session: LiveSession, ports: RuntimeObservationPorts): boolean {
  return herdConfigIsCurrent(request) && ports.currentLive() === session;
}

export async function refreshHerdConfig(ports: RuntimeObservationPorts): Promise<boolean> {
  const session = ports.currentLive();
  const request = nextHerdConfigRequest();
  clearCapabilities();
  if (!session) return false;
  // Only an identity never read is "pending"; a known one stays on screen
  // while a foreground recovery re-reads it.
  if (!runtimeStore.get().runtimeKind) beginIdentityRead();
  if (!acceptedStillCurrent(request, session, ports)) return false;
  try {
    const config = await session.getConfig();
    if (!acceptedStillCurrent(request, session, ports)) return false;
    // External daemon-version listeners can reenter here; revalidate after it.
    ports.acceptDaemonVersion(config);
    if (!acceptedStillCurrent(request, session, ports)) return false;
    let operations;
    try {
      operations = parseRuntimeOperationsConfig(config);
    } catch (error) {
      ports.markDaemonConfigIncompatible();
      throw error;
    }
    const hostname = typeof config.hostname === "string" ? config.hostname : "";
    const runtimeKind = typeof config.runtime === "string" ? config.runtime : "";
    // Capture the credential owner before publishing. One batch: subscribers
    // see the accepted observation as one coherent update, never runtime
    // identity without its push flag or capabilities.
    const credential = ports.currentCredential();
    batch(() => {
      applyRuntimeIdentity({ herdHost: hostname, runtimeKind });
      setPushEnabled(config.push_enabled === true);
      applyCapabilities(operations.capabilities, operations.agentKinds);
      endIdentityRead();
    });
    if (!acceptedStillCurrent(request, session, ports)) return false;
    if (credential && hostname && credential.hostname !== hostname) {
      const updated = { ...credential, hostname, lastSeen: Math.floor(Date.now() / 1000) };
      setCredential(updated);
      if (!acceptedStillCurrent(request, session, ports)) return false;
      await ports.saveCredential(updated).catch(() => undefined);
      if (!acceptedStillCurrent(request, session, ports)) return false;
      await ports.reloadComputers().catch(() => undefined);
      if (!acceptedStillCurrent(request, session, ports)) return false;
    }
    return true;
  } catch {
    if (acceptedStillCurrent(request, session, ports)) {
      batch(() => {
        clearCapabilities();
        applyRuntimeIdentity({ herdHost: "", runtimeKind: "" });
        // A failed read is an answer: the header may now say it cannot confirm.
        endIdentityRead();
      });
      return true;
    }
    return false;
  }
}

export async function refreshRuntimeState(ports: RuntimeObservationPorts): Promise<void> {
  const session = ports.currentLive();
  const updated = await refreshHerdConfig(ports);
  if (!updated || ports.currentLive() !== session) return;
  const notice = noticesStore.get().notice;
  if (runtimeStore.get().runtimeKind === "herdr" && notice?.text === FRIENDLY_ERROR.herdr_offline) clearNotice();
  ports.commitView();
  await ports.refreshFromSession();
}
