import type { ReactElement } from "react";
import { agentMeta, agentTitle, statusLabel } from "../../../lib/dashboard";
import { groupAgents, paneIsPinned } from "../../../lib/ranking";
import { t } from "../../../lib/i18n";
import { openPane } from "../../../features/connection/controller";
import { useDashboard } from "../../dashboard/hooks";
import { usePreferences } from "../../settings/hooks";
import { useSession } from "../hooks";
import { openPaneId } from "../session-store";
import { SelectionRow, EmptyState } from "../../../shared/ui/primitives";
import { MenuItem, showActionSheet, type ActionSheetController } from "../../../shared/ui/overlay/action-sheet";

/**
 * The pane switcher sheet. Its list reads the dashboard and preference domain
 * snapshots it subscribes to; the click handler re-reads the canonical open
 * pane at action time so a later switch can never target a stale pane.
 */
function PaneSwitcherBody({ modal }: { modal: ActionSheetController }): ReactElement {
  const dashboard = useDashboard();
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
      const meta = [statusLabel(agent.status), agentMeta(agent, group)].filter(Boolean).join(" · ");
      return <SelectionRow key={agent.paneId} selected={agent.paneId === session.paneId}
        onClick={() => modal.close(() => { if (agent.paneId !== openPaneId()) void openPane(agent.paneId); })}
        title={agentTitle(agent, group)} description={meta}
        titleLeading={<>
          {paneIsPinned(preferences.panePinned, agent.paneId) && <span className="pin-mark" aria-hidden="true" />}
          <span className={`agent-dot agent-${agent.status}`} />
        </>} />;
    }) : <EmptyState spec={{ figure: "link", title: t("home.switcherEmptyTitle"), sub: t("home.switcherEmpty") }} />}</div>
    <MenuItem modal={modal}>{t("cancel")}</MenuItem>
  </>;
}

export function openPaneSwitcher(): void {
  showActionSheet(t("home.switcherTitle"), (modal) => <PaneSwitcherBody modal={modal} />);
}
