import { commitView } from "../../../app/host";
import { t } from "../../../lib/i18n";
import { TERM_MODE_OPTIONS, type TermMode } from "../../../lib/terminal-mode";
import { TERM_MODE_LABEL, TERM_MODE_MENU } from "../../../lib/ui-model";
import { usePreferences } from "../../settings/hooks";
import { TERM_COL_PRESETS, TERM_FONT_MAX, TERM_FONT_MIN, setTermFont, termFontPx } from "../../settings/preferences-store";
import { useCompose } from "../hooks";
import { canEnterAgentChat } from "../chat/agent-chat-controller";
import { setFullTerminalComposeLive, setTermFit } from "../full-terminal/full-terminal";
import { selectPaneTermMode } from "../term-mode";
import { setComposeLive } from "./compose";
import { toggleTermWrap } from "./term";
import { SegmentedControl } from "../../../shared/ui/primitives";
import { MenuRadio, type ActionSheetController } from "../../../shared/ui/overlay/action-sheet";
import { MenuGroup, MenuSetting, MenuStepper, MenuSwitch } from "../../../shared/ui/overlay/menu-controls";

/**
 * The pane sheet's quick settings. Mode changes the whole screen, so choosing
 * one closes the sheet; everything else applies in place and the reader sees
 * it take effect in the pane behind the (collapsed) sheet.
 */
export function PaneQuickSettings({ modal, mode, full, chat }: {
  modal: ActionSheetController; mode: TermMode; full: boolean; chat: boolean;
}) {
  const prefs = usePreferences();
  const { composeLive } = useCompose();
  const font = (delta: number) => { setTermFont(termFontPx() + delta); commitView(); };
  return <MenuGroup className="pane-quick">
    <MenuSetting label={t("pane.sectionMode")} hint={t("mode.autoHint")} stacked>
      <SegmentedControl className="menu-mode" activation="manual" aria-label={t("mode.aria")}>
        {TERM_MODE_OPTIONS.map(option => <MenuRadio key={option} modal={modal} label={TERM_MODE_LABEL[option]} aria={TERM_MODE_MENU[option]}
          selected={mode === option} disabled={option === "agent" && mode !== option && !canEnterAgentChat()}
          action={() => selectPaneTermMode(option)} />)}
      </SegmentedControl>
    </MenuSetting>
    {full && <MenuSetting label={t("pane.width")} stacked>
      <SegmentedControl className="menu-mode" activation="manual" aria-label={t("pane.width")}>
        <MenuRadio modal={modal} stay label={t("pane.fit")} aria={t("pane.fitAria")} selected={prefs.termFit === "fit"}
          action={() => { setTermFit("fit"); commitView(); }} />
        {TERM_COL_PRESETS.map(cols => <MenuRadio key={cols} modal={modal} stay label={t("pane.colsShort", { cols })}
          aria={t("pane.panColsAria", { cols })} selected={prefs.termFit === "pan" && prefs.termCols === cols}
          action={() => { setTermFit("pan", cols); commitView(); }} />)}
      </SegmentedControl>
    </MenuSetting>}
    {!chat && <>
      <MenuSetting label={t("menu.input")} hint={t(composeLive ? "pane.liveAria" : "pane.composeAria")}>
        <SegmentedControl className="menu-mode menu-seg-compact" activation="manual" aria-label={t("pane.inputAria")}>
          {[{ live: false, label: t("compose.batch"), aria: t("pane.composeAria") },
            { live: true, label: t("compose.live"), aria: t("pane.liveAria") }].map(option => <MenuRadio key={String(option.live)} modal={modal} stay
            label={option.label} aria={option.aria} selected={composeLive === option.live} action={async () => {
              if (full) setFullTerminalComposeLive(option.live);
              else await setComposeLive(option.live);
              commitView();
            }} />)}
        </SegmentedControl>
      </MenuSetting>
      <MenuStepper label={t("pane.fontSize")} value={t("pane.fontPx", { n: prefs.termFontPx })}
        decrease={t("menu.fontDown")} increase={t("menu.fontUp")} onDecrease={() => font(-1)} onIncrease={() => font(1)}
        canDecrease={prefs.termFontPx > TERM_FONT_MIN} canIncrease={prefs.termFontPx < TERM_FONT_MAX} />
      {!full && <MenuSwitch label={t("menu.wrap")} checked={prefs.termWrap} onChange={toggleTermWrap} />}
    </>}
  </MenuGroup>;
}
