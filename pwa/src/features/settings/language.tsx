import { SegmentedControl, SegmentedOption } from "../../shared/ui/primitives";
import { useSyncExternalStore } from "react";
import { clearNotice } from "../../app/notices-store";
import { langPref, langRevision, setLangPref, subscribeLang, t, type LangPref } from "../../lib/i18n";

/**
 * Language preference controls. Connected: a change persists the preference,
 * clears the current notice, and publishes the i18n revision so every mounted
 * copy re-renders through the language subscription — no global repaint.
 */

const LANG_OPTIONS = [
  { id: "auto", key: "settings.langAuto", compact: "chrome.langAuto" },
  { id: "zh", key: "settings.langZh", compact: "settings.langZh" },
  { id: "en", key: "settings.langEn", compact: "settings.langEn" },
] as const;

/** Re-render copy on the i18n revision (advances on every applied language action). */
export function useLang(): void {
  useSyncExternalStore(subscribeLang, langRevision);
}

export function applyLanguage(next: LangPref): void {
  if (langPref() === next) return;
  setLangPref(next);
  clearNotice();
}

export function LanguageControl({ className }: { className?: string }) {
  useLang();
  return <SegmentedControl className={className} aria-label={t("settings.langAria")}>
    {LANG_OPTIONS.map(option => <SegmentedOption key={option.id} selected={langPref() === option.id} onClick={() => applyLanguage(option.id)}>
      {t(option.key)}
    </SegmentedOption>)}
  </SegmentedControl>;
}

export function LanguageSelect() {
  useLang();
  return <select className="lang-select" aria-label={t("settings.langAria")} value={langPref()}
    onChange={event => applyLanguage(event.currentTarget.value === "en" || event.currentTarget.value === "zh" ? event.currentTarget.value : "auto")}>
    {LANG_OPTIONS.map(option => <option key={option.id} value={option.id}>{t(option.compact)}</option>)}
  </select>;
}