import { ChevronRight, Monitor } from "lucide-react";
import { openComputers } from "../../features/computers/actions";
import type { HerdStatus } from "../../features/connection/herd-status";
import { revokeSelf } from "../../features/operations/controller";
import { DaemonUpdate } from "../../features/settings/daemon-update-view";
import { exportConnectionDiagnostics } from "../../features/settings/connection-diagnostics";
import { setSettingsSection } from "../../features/settings/settings-section";
import { t } from "../../lib/i18n";
import type { TermMode } from "../../lib/terminal-mode";
import { TERM_MODE_LABEL } from "../../lib/ui-model";
import type { HelpBlock } from "../../shared/ui/overlay";
import { Button, SetHeading, SetNavRow, StatusDot } from "../../shared/ui/primitives";
import { AgentQuotaSummary } from "../../pages/quota/quota-summary";
import { composeLabel, enterSendsLabel, languageLabel, notificationValue, openComposeSheet, openEnterSendsSheet, openLanguageSheet, openNotificationSheet, openTermModeSheet } from "./settings-controls";

export type SettingsOverviewInput = {
  computerName: string;
  /** Status sentence, or "Connected · path" when all is well. */
  computerLine: string;
  status: HerdStatus;
  computerCount: number;
  deviceCount: number;
  defaultTermMode: TermMode;
  defaultComposeLive: boolean;
  composeEnterSends: boolean;
  pushNote: string;
  pushAction: { label: string; disabled: boolean };
  notifyHelp?: () => HelpBlock[];
};

/**
 * The Settings overview: the computer first (tap for the connection page), the
 * daemon update when one is waiting, agent usage, then one line per choice with
 * its current value. Explanations live on the sheets and sub-pages, not here.
 */
export function SettingsOverview({ input }: { input: SettingsOverviewInput }) {
  const notification = { note: input.pushNote, action: input.pushAction, help: input.notifyHelp };
  return (
    <>
      <div className="set-card">
        <Button className="set-hero" onClick={() => setSettingsSection("connection")}>
          <span className="set-hero-mark" aria-hidden="true"><Monitor size={22} /></span>
          <span className="set-hero-text">
            <span className="set-hero-name">{input.computerName}</span>
            <span className={`set-hero-line is-${input.status.tone}`}><StatusDot tone={input.status.tone} />{input.computerLine}</span>
          </span>
          <ChevronRight className="chev" size={16} aria-hidden="true" />
        </Button>
        <SetNavRow label={t("settings.switchComputer")} value={t("settings.countUnit", { n: String(input.computerCount) })}
          onClick={openComputers} />
      </div>
      <DaemonUpdate />
      <AgentQuotaSummary />
      <SetHeading text={t("settings.defaults")} help={[t("settings.modeNote"), t("settings.inputNote")]} />
      <div className="set-card">
        <SetNavRow label={t("settings.mode")} value={TERM_MODE_LABEL[input.defaultTermMode]}
          onClick={() => openTermModeSheet(input.defaultTermMode)} />
        <SetNavRow label={t("settings.input")} value={composeLabel(input.defaultComposeLive)}
          onClick={() => openComposeSheet(input.defaultComposeLive)} />
        <SetNavRow label={t("settings.enterSends")} value={enterSendsLabel(input.composeEnterSends)}
          onClick={() => openEnterSendsSheet(input.composeEnterSends)} />
      </div>
      <SetHeading text={t("settings.phoneSection")} />
      <div className="set-card">
        <SetNavRow label={t("settings.notifications")} value={notificationValue(notification)}
          onClick={() => openNotificationSheet(notification)} />
        <SetNavRow label={t("settings.language")} value={languageLabel()} onClick={openLanguageSheet} />
        <SetNavRow label={t("settings.devices")} value={t("settings.countUnit", { n: String(input.deviceCount) })}
          onClick={() => setSettingsSection("devices")} />
        {/* The scope note ("this tab · last 24 hours") sits on the connection page; here it would not fit. */}
        <SetNavRow label={t("settings.exportConnectionDiagnostics")} value="" onClick={exportConnectionDiagnostics} />
      </div>
      <SetHeading text={t("settings.danger")} />
      <div className="set-card">
        <div className="set-row set-row-stack">
          <p className="set-note">{t("settings.unpairNote")}</p>
          <Button className="btn btn-small btn-danger" onClick={() => void revokeSelf()}>{t("settings.unpair")}</Button>
        </div>
      </div>
    </>
  );
}
