import { useSyncExternalStore } from "react";
import { openQuota } from "../../features/agent-quota/actions";
import { quotaModuleModel } from "../../features/agent-quota/model";
import { QuotaModuleView } from "../../features/agent-quota/quota-module-view";
import { quotaSnapshot, subscribeQuota } from "../../features/agent-quota/store";
import { useEstablishedSession } from "./quota-page";

/**
 * The quota module the settings page composes.
 *
 * Same session contract as the quota page: subscribe to the computers domain so
 * typed attach/detach updates a mounted module without paint, and read the
 * live record so an unpublished facade attach is visible on the next render.
 */
export function AgentQuotaModule() {
  const session = useEstablishedSession();
  const snapshot = useSyncExternalStore(subscribeQuota, () => quotaSnapshot(session));
  return <QuotaModuleView model={quotaModuleModel(snapshot, session?.isConnected() === true)} onOpen={openQuota} />;
}
