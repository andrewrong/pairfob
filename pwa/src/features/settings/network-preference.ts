/** Shared network preference action for Settings and attachment connection UI. */
import { liveSession } from "../computers/catalog-store";
import { networkMode, p2pEnabled, sessionTransport, setNetworkMode, setTransportSwitching } from "../connection/connection-store";
import { clearNotice, showError, showStatus } from "../../app/notices-store";
import { t } from "../../lib/i18n";
import type { NetworkMode } from "../../lib/network-mode";
import { directFailureDiagnostic, type LiveSession } from "../../lib/protocol/client";

// The connection coordinator owns the inactive session pool. Its narrow port
// keeps this action independent of screens, terminal rendering and lifecycle.
let syncInactiveTransportMode: (mode: NetworkMode, active?: LiveSession) => void = () => {};
export function bindInactiveNetworkPreference(sync: typeof syncInactiveTransportMode): void {
  syncInactiveTransportMode = sync;
}

let networkModeSeq = 0;

function p2pFailureMessage(error: unknown): string {
  const diagnostic = directFailureDiagnostic(error);
  let detail = "";
  switch (diagnostic) {
    case "ice_timeout":
    case "ice_failed":
    case "offer":
      detail = t("settings.networkP2PFailedICE");
      break;
    case "channel_timeout":
    case "channel_failed":
      detail = t("settings.networkP2PFailedChannel");
      break;
    case "signal":
    case "answer":
      detail = t("settings.networkP2PFailedSignal");
      break;
    case "handshake":
    case "commit":
    case "probe":
      detail = t("settings.networkP2PFailedVerify");
  }
  return detail ? `${t("settings.networkP2PFailed")} ${detail}` : t("settings.networkP2PFailed");
}

export async function selectNetworkMode(mode: NetworkMode): Promise<void> {
  if (mode === "p2p" && !p2pEnabled()) return;
  const retry = mode === "p2p" && sessionTransport() !== "p2p";
  if (networkMode() === mode && !retry) return;
  setNetworkMode(mode);
  const session = liveSession();
  const seq = ++networkModeSeq;
  if (!session) {
    syncInactiveTransportMode(mode);
    return;
  }
  syncInactiveTransportMode(mode, session);
  const fromP2P = sessionTransport() === "p2p";
  const connected = session.isConnected();
  setTransportSwitching(true);
  if (connected) {
    if (mode === "p2p") showStatus(t("settings.networkTryingP2P"), true);
    else if (mode === "relay" && fromP2P) showStatus(t("settings.networkSwitchingRelay"), true);
    else if (mode === "auto" && !fromP2P && p2pEnabled()) showStatus(t("settings.networkTryingP2P"));
  }
  try {
    await session.switchTransport(mode);
    if (seq !== networkModeSeq || liveSession() !== session) return;
    if (mode === "p2p" && sessionTransport() === "p2p") showStatus(t("settings.networkP2PConnected"));
    else clearNotice();
  } catch (error) {
    if (seq !== networkModeSeq || liveSession() !== session) return;
    showError(mode === "relay" ? t("settings.networkRelayFailed") : p2pFailureMessage(error));
  } finally {
    if (seq === networkModeSeq && liveSession() === session) setTransportSwitching(false);
  }
}
