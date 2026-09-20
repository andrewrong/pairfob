import { liveSession } from "../../computers/catalog-store";
import { isAgentChat, openPaneId } from "../session-store";
import {
  agentTraceDetailState,
  setAgentTraceDetailState,
  type AgentTraceDetailState,
} from "../../../lib/agent-trace-cache";
import { messageOf } from "../../../lib/notices";
import { currentTraceOwnerVersion } from "./trace-store";

export function toolDetailView(paneId: string, detailRef: string): AgentTraceDetailState {
  return agentTraceDetailState(paneId, detailRef);
}

export function loadToolDetail(paneId: string, detailRef: string, changed: () => void): void {
  const session = liveSession();
  const current = agentTraceDetailState(paneId, detailRef);
  const ownerVersion = currentTraceOwnerVersion();
  if (!session || !detailRef || current.status === "loading" || current.status === "ready") return;
  setAgentTraceDetailState(paneId, detailRef, { status: "loading" });
  changed();
  void session.agentTraceDetail(paneId, detailRef).then((detail) => {
    if (liveSession() !== session || ownerVersion !== currentTraceOwnerVersion() || agentTraceDetailState(paneId, detailRef).status !== "loading") return;
    setAgentTraceDetailState(paneId, detailRef, { status: "ready", detail });
    if (isAgentChat() && openPaneId() === paneId) changed();
  }).catch((error) => {
    if (liveSession() !== session || ownerVersion !== currentTraceOwnerVersion() || agentTraceDetailState(paneId, detailRef).status !== "loading") return;
    setAgentTraceDetailState(paneId, detailRef, { status: "error", message: messageOf(error, "read") });
    if (isAgentChat() && openPaneId() === paneId) changed();
  });
}
