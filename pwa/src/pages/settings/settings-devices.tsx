import { Monitor, Smartphone, Tablet } from "lucide-react";
import type { RuntimeRecord } from "../../features/connection/runtime-store";
import { revokeDevice } from "../../features/operations/controller";
import { refreshSettings } from "../../features/settings/actions";
import { t } from "../../lib/i18n";
import { type DeviceSummary } from "../../lib/protocol/client";
import { displayDeviceLabel, formatDeviceAge, shortDeviceId, visiblePairedDevices } from "../../lib/ui-model";
import type { DomainView } from "../../shared/model/domain-store";
import { SetAction, SetGroup, SetItem, SetTag } from "../../shared/ui/primitives";

/**
 * Paired devices, listed on the computer page: this phone first with its tag,
 * then every other device with an unpair action on the trailing edge. A device
 * id shows only when two devices share a name, so the list reads by name.
 */

function DeviceMark({ label }: { label: string }) {
  const Icon = /ipad|tablet|平板/i.test(label) ? Tablet
    : /mac|windows|linux|desktop|laptop|电脑|browser|浏览器/i.test(label) ? Monitor : Smartphone;
  return <span className="set-icon" aria-hidden="true"><Icon size={17} /></span>;
}

function DeviceItem({ device, connected, clash }: { device: DeviceSummary; connected: boolean; clash: boolean }) {
  const name = displayDeviceLabel(device.label || "") || t("device.unnamed");
  const presence = device.self ? null : device.connected === true ? t("device.connected") : device.connected === false ? t("device.offline") : null;
  const sub = [presence, formatDeviceAge(device.last_seen || device.created_at),
    t(device.subscription_count ? "set.notifyOn" : "set.notifyOff"), clash ? shortDeviceId(device.device_id) : null]
    .filter(Boolean).join(" · ");
  return <SetItem className="device-item" leading={<DeviceMark label={name} />} label={name} sub={sub}
    trailing={device.self ? <SetTag tone="accent">{t("device.self")}</SetTag>
      : <SetAction tone="danger" className="device-forget" aria-label={t("settings.unpairOtherAria", { name })} disabled={!connected}
          onClick={() => void revokeDevice(device)}>{t("settings.unpairOther")}</SetAction>} />;
}

export function DevicesGroup({ runtime, connected }: { runtime: DomainView<RuntimeRecord>; connected: boolean }) {
  const devices = visiblePairedDevices([...runtime.deviceList]);
  const names = devices.map(device => displayDeviceLabel(device.label || ""));
  const loading = runtime.settingsLoading && !devices.length;
  const note = !connected ? t("set.devicesOffline")
    : devices.some(device => !device.self) ? <>{t("settings.manageOthersBody")}<code>pairfob forget N</code>{t("settings.sentenceEnd")}</> : null;
  return <SetGroup className="devices-group" icons label={devices.length && !runtime.devicesError ? t("set.devicesCount", { n: devices.length }) : t("settings.devices")} note={note}>
    {runtime.devicesError ? <SetItem className="is-error" label={runtime.devicesError}
        trailing={<SetAction onClick={() => void refreshSettings()}>{t("retry")}</SetAction>} />
      : loading ? [0, 1].map(index => <SetItem key={index} className="is-skeleton" leading={<span className="set-icon" />}
          label={<span className="skel" />} sub={<span className="skel skel-short" />} />)
      : devices.map((device, index) => <DeviceItem key={device.device_id} device={device} connected={connected}
          clash={names.indexOf(names[index]!) !== names.lastIndexOf(names[index]!)} />)}
  </SetGroup>;
}
