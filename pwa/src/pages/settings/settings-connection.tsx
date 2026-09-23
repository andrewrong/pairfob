import { openComputers } from "../../features/computers/actions";
import type { ConnectionRecord } from "../../features/connection/connection-store";
import type { HerdStatus } from "../../features/connection/herd-status";
import { exportConnectionDiagnostics } from "../../features/settings/connection-diagnostics";
import { settingsNetworkP2PFail, settingsNetworkPath, type SettingsNetworkInput } from "../../features/settings/model";
import { t } from "../../lib/i18n";
import { SetNavRow, SetRow } from "../../shared/ui/primitives";
import { NetworkModeControl } from "./settings-controls";

/**
 * The connection page behind the overview's computer card: which computer, its
 * status, the path in use, the network mode switch with its notes, diagnostics
 * and this phone's paired name.
 */
export function ConnectionSection({ connection, network, status, computerName, phoneName }: {
  connection: ConnectionRecord;
  network: SettingsNetworkInput;
  status: HerdStatus;
  computerName: string;
  phoneName: string | null;
}) {
  const p2pFail = settingsNetworkP2PFail(network);
  return (
    <>
      <div className="set-card">
        <SetNavRow label={t("settings.computer")} value={computerName} onClick={openComputers} />
        <SetRow label={t("settings.status")} value={status.text} tone={status.tone} />
        <SetRow label={t("settings.networkRtt")} value={settingsNetworkPath(network)} />
        <div className="set-row set-row-stack network-mode-row">
          {p2pFail ? <p className="set-note network-p2p-fail">{p2pFail}</p> : null}
          {!connection.p2pEnabled ? <p className="set-note">{t("settings.networkP2POff")}</p> : null}
          <NetworkModeControl connection={connection} />
        </div>
        <SetNavRow label={t("settings.exportConnectionDiagnostics")} value={t("settings.connectionDiagnosticsLocal")} onClick={exportConnectionDiagnostics} />
        {phoneName ? <SetRow label={t("settings.thisPhone")} value={phoneName} /> : null}
      </div>
    </>
  );
}
