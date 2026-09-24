import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { enablePush, refreshSettings } from "../../features/settings/actions";
import { t } from "../../lib/i18n";
import { CommandLine, SetAction, SetItem } from "../../shared/ui/primitives";

/**
 * This phone's notifications, handled on the row: turn on at the trailing
 * edge, a green "on" once subscribed, and — when the computer has not enabled
 * push — the setup steps expand inside the card instead of a second dialog.
 */

export type NotificationRowInput = {
  loading: boolean;
  connected: boolean;
  supported: boolean;
  /** null: not read yet or unreadable. */
  pushEnabled: boolean | null;
  pushSubscribed: boolean | null;
  error: string;
};

const PUSH_ENV = "PAIRFOB_PUSH=1\nPAIRFOB_VAPID_SUBJECT=mailto:you@example.com";
const copyLabels = () => ({ copy: t("set.copy"), copied: t("set.copied"), failed: t("set.copyFailed") });

export function NotificationItem({ input }: { input: NotificationRowInput }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  let sub = t(input.pushSubscribed === true ? "settings.pushOn" : "settings.pushOff");
  let subTone: "error" | undefined;
  let trailing;
  let steps = false;
  if (input.error) {
    sub = input.error;
    subTone = "error";
    trailing = <SetAction onClick={() => void refreshSettings()}>{t("retry")}</SetAction>;
  } else if (!input.connected) {
    trailing = <span className="set-state">{t("set.needsConnection")}</span>;
  } else if (input.loading && input.pushEnabled === null) {
    trailing = <span className="skel" aria-label={t("push.loading")} />;
  } else if (!input.supported) {
    sub = t("err.pushUnsupported");
    trailing = <span className="set-state">{t("set.pushUnsupported")}</span>;
  } else if (input.pushEnabled === false) {
    sub = t("settings.pushComputerOff");
    steps = open;
    trailing = <SetAction aria-expanded={open} onClick={() => setOpen(!open)}>
      {t("set.pushHowto")}<ChevronDown className={`set-disclosure${open ? " is-open" : ""}`} size={14} aria-hidden="true" />
    </SetAction>;
  } else if (input.pushSubscribed === true) {
    trailing = <span className="set-state is-ok"><Check size={16} aria-hidden="true" />{t("set.pushOnShort")}</span>;
  } else if (input.pushEnabled === null) {
    trailing = <SetAction onClick={() => void refreshSettings()}>{t("retry")}</SetAction>;
  } else {
    trailing = <SetAction tone="fill" disabled={busy} aria-busy={busy || undefined} onClick={() => {
      setBusy(true);
      void enablePush().finally(() => setBusy(false));
    }}>{busy ? t("set.pushEnabling") : t("set.pushEnable")}</SetAction>;
  }
  return <div className="set-item-group notification-item">
    <SetItem label={t("settings.notifications")} sub={sub} subTone={subTone} trailing={trailing} />
    {steps ? <ol className="set-steps">
      <li>{t("set.pushStepEnv")}<CommandLine command={PUSH_ENV} labels={copyLabels()} /></li>
      <li>{t("set.pushStepRestart")}<CommandLine command="pairfob service restart" labels={copyLabels()} /></li>
      <li>{t("set.pushStepBack")}</li>
    </ol> : null}
  </div>;
}
