import { t } from "../../../lib/i18n";
import { TERM_MODE_OPTIONS } from "../../../lib/terminal-mode";
import { TERM_MODE_LABEL, TERM_MODE_MENU } from "../../../lib/ui-model";
import { paneTermMode } from "../../settings/preferences-store";
import { canEnterAgentChat } from "../chat/agent-chat-controller";
import { openPaneId } from "../session-store";
import { selectPaneTermMode } from "../term-mode";
import { MenuItem, MenuRadio, showActionSheet } from "../../../shared/ui/overlay/action-sheet";
import { SegmentedControl } from "../../../shared/ui/primitives";

/** A focused entry to the same per-pane preferences used by the full menu. */
export function openModePicker(): void {
  const paneId = openPaneId();
  if (!paneId) return;
  const current = paneTermMode(paneId);
  showActionSheet(t("pane.sectionMode"), modal => <>
    <SegmentedControl className="menu-mode" activation="manual" aria-label={t("mode.aria")}>
      {TERM_MODE_OPTIONS.map(mode => <MenuRadio key={mode} modal={modal}
        label={TERM_MODE_LABEL[mode]} aria={TERM_MODE_MENU[mode]} selected={current === mode}
        disabled={mode === "agent" && current !== mode && !canEnterAgentChat()}
        action={() => { if (openPaneId() === paneId) return selectPaneTermMode(mode); }} />)}
    </SegmentedControl>
    <p className="empty-sub">{t("mode.autoHint")}</p>
    {!canEnterAgentChat() && <p className="empty-sub">{t("mode.agentUnavailable")}</p>}
    <MenuItem modal={modal}>{t("cancel")}</MenuItem>
  </>);
}
