import type { RuntimeRecord } from "../../features/connection/runtime-store";
import { revokeDevice } from "../../features/operations/controller";
import { t } from "../../lib/i18n";
import { type DeviceSummary } from "../../lib/protocol/client";
import { displayDeviceLabel, formatDeviceAge, shortDeviceId, visiblePairedDevices } from "../../lib/ui-model";
import type { DomainView } from "../../shared/model/domain-store";
import { Button, EmptyState, Feedback } from "../../shared/ui/primitives";
import { helpWithCode } from "./settings-controls";

function DeviceRow({ device, connected }: { device: DeviceSummary; connected: boolean }) {
  const name = displayDeviceLabel(device.label || "") || t("device.unnamed");
  const activity = t("device.lastUsed", { when: formatDeviceAge(device.last_seen || device.created_at) });
  const notifications = device.subscription_count ? t("device.notifyOn") : t("device.notifyOff");
  return (
    <div className="device">
      <div className="device-body">
        <div className="device-head">
          <strong className="device-name">{name}</strong>
          {device.self ? <span className="pill pill-live">{t("device.self")}</span> : null}
          {!device.self && device.connected === true ? <span className="pill pill-live">{t("device.connected")}</span> : null}
          {!device.self && device.connected === false ? <span className="pill pill-idle">{t("device.offline")}</span> : null}
        </div>
        <code className="device-id" title={device.device_id}>
          {shortDeviceId(device.device_id)}
        </code>
        <p className="device-meta">{activity + notifications}</p>
      </div>
      {!device.self ? (
        <Button
          className="device-forget"
          aria-label={t("settings.unpairOtherAria", { name })}
          disabled={!connected}
          onClick={() => void revokeDevice(device)}
        >{t("settings.unpairOther")}</Button>
      ) : null}
    </div>
  );
}

/** Help for managing other devices, shown beside the page title when there are any. */
export function devicesHelp(runtime: DomainView<RuntimeRecord>) {
  return visiblePairedDevices([...runtime.deviceList]).some((device) => !device.self)
    ? () => [helpWithCode(t("settings.manageOthersBody"), "pairfob forget N", t("settings.sentenceEnd"))]
    : undefined;
}

/** Paired devices: the Settings "Paired devices" page. */
export function DevicesSection({ runtime, connected }: { runtime: DomainView<RuntimeRecord>; connected: boolean }) {
  const devices = visiblePairedDevices([...runtime.deviceList]);
  return (
    <>
      {runtime.settingsLoading && !devices.length ? (
        <Feedback value={{ text: t("settings.devicesLoading"), tone: "status" }} />
      ) : runtime.devicesError ? (
        <Feedback value={{ text: runtime.devicesError, tone: "error" }} />
      ) : devices.length ? (
        <div className="set-card device-card">
          {devices.map((device) => (
            <DeviceRow key={device.device_id} device={device} connected={connected} />
          ))}
        </div>
      ) : (
        <EmptyState spec={{ figure: "device", title: t("settings.noOtherDevicesTitle"), sub: t("settings.noOtherDevices") }} />
      )}
    </>
  );
}
