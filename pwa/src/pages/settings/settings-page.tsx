import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useRememberedScroll } from "../../shared/ui/dom/remembered-scroll";
import { useComputers } from "../../features/computers/hooks";
import { useConnection, useRuntime } from "../../features/connection/hooks";
import { usePreferences } from "../../features/settings/hooks";
import { computerTitle } from "../../lib/computer-catalog";
import { t } from "../../lib/i18n";
import { displayDeviceLabel, notificationAction, visiblePairedDevices } from "../../lib/ui-model";
import { leaveSettings, refreshSettings } from "../../features/settings/actions";
import { settingsNetworkHelp, settingsNetworkPath } from "../../features/settings/model";
import { setSettingsSection, settingsSection, subscribeSettingsSection } from "../../features/settings/settings-section";
import { herdStatusOf } from "../../features/connection/herd-status";
import { AppNotice } from "../../app/notice";
import { BackBar, Button, Feedback, HelpButton } from "../../shared/ui/primitives";
import { helpWithCode, useLang } from "./settings-controls";
import { ConnectionSection } from "./settings-connection";
import { DevicesSection, devicesHelp } from "./settings-devices";
import { SettingsOverview } from "./settings-overview";

/**
 * Settings: an overview with one line per choice, and two sub-pages — the
 * connection page behind the computer card and the paired-devices page. On a
 * phone the page is a tab root (no back); on the desktop it keeps its back bar.
 */
function useSettingsView() {
  const connection = useConnection();
  const runtime = useRuntime();
  const preferences = usePreferences();
  const computers = useComputers();
  const section = useSyncExternalStore(subscribeSettingsSection, settingsSection);
  // However Settings is left — back, a tab, a desk page swap — it reopens on the overview.
  useEffect(() => () => setSettingsSection("overview"), []);
  // The overview keeps its place across tabs and a detail page; a detail page
  // always opens at its top.
  useRememberedScroll("settings", section === "overview");
  useLayoutEffect(() => {
    if (section !== "overview") window.scrollTo(0, 0);
  }, [section]);
  return { connection, runtime, preferences, computers, section };
}

export function SettingsContent({ withBack }: { withBack: boolean }) {
  const { connection, runtime, preferences, computers, section } = useSettingsView();
  useLang();
  // Project the status row from the same published snapshots the surrounding
  // panel reads. The live handle is the snapshot's opaque identity; a staged
  // composition hold keeps the panel on the published phase/online values until
  // the queued commit, so the row can never show offline a frame early.
  const connected = computers.live?.isConnected() === true;
  const status = herdStatusOf({
    connected,
    checking: computers.live?.isChecking?.() === true,
    networkOnline: connection.networkOnline,
    runtimeKind: runtime.runtimeKind,
    herdHost: runtime.herdHost,
  });
  const network = {
    sessionTransport: connection.sessionTransport,
    relayRttMs: connection.relayRttMs,
    p2pEnabled: connection.p2pEnabled,
    networkMode: connection.networkMode,
    lastP2PAttempt: connection.lastP2PAttempt,
  };
  const computerName = runtime.herdHost || (computers.credential ? computerTitle(computers.credential) : t("settings.currentComputer"));
  const self = runtime.deviceList.find((device) => device.self && !device.revoked_at);
  const notifyHelp =
    runtime.pushEnabled === false && !runtime.settingsLoading
      ? () => [helpWithCode(t("settings.pushHowtoBody"), "PAIRFOB_PUSH=1", t("settings.pushHowtoTail"))]
      : undefined;
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const pushAction = notificationAction(runtime.pushEnabled, runtime.pushSubscribed, pushSupported, runtime.settingsLoading);
  const pushNote = runtime.pushEnabled === false
    ? t("settings.pushComputerOff")
    : runtime.pushSubscribed === true ? t("settings.pushOn") : t("settings.pushOff");
  const back = section === "overview" ? (withBack ? leaveSettings : null) : () => setSettingsSection("overview");
  const title = section === "connection" ? t("settings.connection") : section === "devices" ? t("settings.devices") : t("settings.title");
  // Long explanations stay behind the title's help button, not on the page.
  const help = section === "devices" ? devicesHelp(runtime)
    : section === "connection" ? [settingsNetworkHelp(network)] : undefined;
  return (
    <>
      {back ? <BackBar title={title} onBack={back}>{help ? <HelpButton title={title} blocks={help} /> : null}</BackBar>
        : <h1 className="settings-title">{title}</h1>}
      <AppNotice />
      {section === "connection" ? (
        <ConnectionSection connection={connection} network={network} status={status} computerName={computerName}
          phoneName={self ? displayDeviceLabel(self.label || "") || t("settings.pairedPhone") : null} />
      ) : section === "devices" ? (
        <DevicesSection runtime={runtime} connected={connected} />
      ) : (
        <SettingsOverview input={{
          computerName,
          computerLine: status.tone === "live" ? t("settings.connectedVia", { path: settingsNetworkPath(network) }) : status.text,
          status,
          computerCount: computers.computers.length || 1,
          deviceCount: visiblePairedDevices([...runtime.deviceList]).length,
          defaultTermMode: preferences.defaultTermMode,
          defaultComposeLive: preferences.defaultComposeLive,
          composeEnterSends: preferences.composeEnterSends,
          pushNote,
          pushAction,
          notifyHelp,
        }} />
      )}
      {runtime.pushConfigError ? <Feedback value={{ text: runtime.pushConfigError, tone: "error" }} /> : null}
      {runtime.devicesError || runtime.pushConfigError ? (
        <Button className="btn btn-small btn-ghost retry" onClick={() => void refreshSettings()}>{t("retry")}</Button>
      ) : null}
    </>
  );
}

/** The phone Settings tab root. The desktop mounts `SettingsContent` in the desk shell. */
export function SettingsScreen() {
  return (
    <div className="page settings-page">
      <SettingsContent withBack={false} />
    </div>
  );
}
