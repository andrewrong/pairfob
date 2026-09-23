import { useSyncExternalStore } from "react";
import type { ConnectionRecord } from "../../features/connection/connection-store";
import { selectNetworkMode } from "../../features/settings/actions";
import { applyLanguage } from "../../features/settings/language";
import { setDefaultComposeLive, setDefaultTermMode } from "../../features/settings/preferences-store";
import { langPref, langRevision, subscribeLang, t, type LangPref } from "../../lib/i18n";
import { NETWORK_MODE_OPTIONS, type NetworkMode } from "../../lib/network-mode";
import { TERM_MODE_OPTIONS, type TermMode } from "../../lib/terminal-mode";
import { TERM_MODE_LABEL } from "../../lib/ui-model";
import { MenuChoice, showActionSheet } from "../../shared/ui/overlay";
import { SegmentedControl, SegmentedOption } from "../../shared/ui/primitives";

/**
 * Settings controls shared by the overview and its sub-pages: the network mode
 * switch, and the choice sheets behind the overview's one-line rows.
 */

const NETWORK_MODE_COPY: Record<NetworkMode, "settings.networkAuto" | "settings.networkP2P" | "settings.networkRelay"> = {
  auto: "settings.networkAuto",
  p2p: "settings.networkP2P",
  relay: "settings.networkRelay",
};

const LANG_COPY: Record<LangPref, "settings.langAuto" | "settings.langZh" | "settings.langEn"> = {
  auto: "settings.langAuto",
  zh: "settings.langZh",
  en: "settings.langEn",
};

export function helpWithCode(before: string, code: string, after: string) {
  return { before, code, after };
}

/** Re-render mounted copy on the i18n revision (advances on every applied language action). */
export function useLang(): void {
  useSyncExternalStore(subscribeLang, langRevision);
}

export function languageLabel(pref: LangPref = langPref()): string {
  return t(LANG_COPY[pref]);
}

export function composeLabel(live: boolean): string {
  return live ? t("compose.live") : t("compose.batch");
}

export function NetworkModeControl({ connection }: { connection: ConnectionRecord }) {
  return (
    <SegmentedControl aria-label={t("settings.networkAria")} aria-busy={connection.transportSwitching || undefined}>
      {NETWORK_MODE_OPTIONS.map((id) => {
        const selected = connection.networkMode === id;
        return (
          <SegmentedOption
            key={id}
            selected={selected}
            disabled={id === "p2p" && !connection.p2pEnabled}
            onClick={() => void selectNetworkMode(id)}
          >{t(NETWORK_MODE_COPY[id])}</SegmentedOption>
        );
      })}
    </SegmentedControl>
  );
}

export function openTermModeSheet(current: TermMode): void {
  showActionSheet(t("settings.modeSheet"), (modal) => (
    <>
      {TERM_MODE_OPTIONS.map((id) => (
        <MenuChoice key={id} modal={modal} title={TERM_MODE_LABEL[id]} selected={current === id}
          detail={id === "auto" ? t("mode.autoHint") : undefined}
          action={current === id ? undefined : () => setDefaultTermMode(id)} />
      ))}
    </>
  ), { subtitle: t("settings.defaults") });
}

export function openComposeSheet(currentLive: boolean): void {
  showActionSheet(t("settings.inputSheet"), (modal) => (
    <>
      {[false, true].map((live) => (
        <MenuChoice key={live ? "live" : "batch"} modal={modal} title={composeLabel(live)} selected={currentLive === live}
          action={currentLive === live ? undefined : () => setDefaultComposeLive(live)} />
      ))}
    </>
  ), { subtitle: t("settings.inputNote") });
}

export function openLanguageSheet(): void {
  const current = langPref();
  showActionSheet(t("settings.langSheet"), (modal) => (
    <>
      {(["auto", "zh", "en"] as const).map((pref) => (
        <MenuChoice key={pref} modal={modal} title={languageLabel(pref)} selected={current === pref}
          action={current === pref ? undefined : () => applyLanguage(pref)} />
      ))}
    </>
  ), { subtitle: t("settings.languageNote") });
}
