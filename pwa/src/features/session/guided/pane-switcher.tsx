import { Pin } from "lucide-react";
import type { ReactElement } from "react";
import { agentMeta, agentStatusLabel, agentTitle } from "../../../lib/dashboard";
import { groupAgents, paneIsPinned } from "../../../lib/ranking";
import { t } from "../../../lib/i18n";
import { openPane } from "../../../features/connection/controller";
import { useDashboard } from "../../dashboard/hooks";
import { usePreferences } from "../../settings/hooks";
import { useSession } from "../hooks";
import { openPaneId } from "../session-store";
import { SelectionRow, EmptyState } from "../../../shared/ui/primitives";
import { useStatusUnverifiable } from "./session-chrome";
import { MenuItem, showActionSheet, type ActionSheetController } from "../../../shared/ui/overlay/action-sheet";

/**
 * The pane switcher sheet. Its list reads the dashboard and preference domain
 * snapshots it subscribes to; the click handler re-reads the canonical open
 * pane at action time so a later switch can never target a stale pane.
 */
function PaneSwitcherBody({ modal }: { modal: ActionSheetController }): ReactElement {
  const dashboard = useDashboard();
  const stale = useStatusUnverifiable();
  const preferences = usePreferences();
  const session = useSession();
  const agents = groupAgents(
    dashboard.agents,
    preferences.listGroup,
    preferences.paneTouched,
    preferences.panePinned,
  ).flatMap((group) => group.items);
  const group = preferences.listGroup;
  return <>
    <div className="switch-list">{agents.length ? agents.map((agent) => {
      // The same status words the header and the list use, and nothing current while unverifiable.
      const meta = [stale ? t("status.unverifiable") : agentStatusLabel(agent), agentMeta(agent, group)].filter(Boolean).join(" · ");
      return <SelectionRow key={agent.paneId} selected={agent.paneId === session.paneId}
        onClick={() => modal.close(() => { if (agent.paneId !== openPaneId()) void openPane(agent.paneId); })}
        title={agentTitle(agent, group)} description={meta}
        titleLeading={<>
          {paneIsPinned(preferences.panePinned, agent.paneId) && <Pin className="pin-mark" size={12} aria-hidden="true" />}
          <span className={`agent-dot agent-${stale ? "unknown" : agent.status}`} />
        </>} />;
    }) : <EmptyState spec={{ figure: "link", title: t("home.switcherEmptyTitle"), sub: t("home.switcherEmpty") }} />}</div>
    <MenuItem modal={modal}>{t("cancel")}</MenuItem>
  </>;
}

export function openPaneSwitcher(): void {
  showActionSheet(t("home.switcherTitle"), (modal) => <PaneSwitcherBody modal={modal} />);
}
