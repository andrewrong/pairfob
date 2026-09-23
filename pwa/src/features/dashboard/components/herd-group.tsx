import { MoreHorizontal, Plus } from "lucide-react";
import { t } from "../../../lib/i18n";
import { Button, Chevron } from "../../../shared/ui/primitives";
import { useObjectPress } from "../../../shared/ui/overlay";
import type { HerdActions } from "../actions";
import type { HerdGroupView } from "../model/herd-view";
import { AgentCard } from "./agent-card";
import { indexedStyle } from "./indexed";

/**
 * One accordion section: a workspace or agent group, or the pinned group.
 *
 * The heading folds the section. A workspace heading also shows its root path,
 * the rows inside that need the reader (so a folded section still reports
 * them), a + that opens the create sheet on this workspace and a visible menu
 * button; the hold on the heading still opens the same menu.
 */
export function HerdGroup({
  group,
  groupIds,
  actions,
}: {
  group: HerdGroupView;
  groupIds: string[];
  actions: HerdActions;
}) {
  const press = useObjectPress(() => actions.openWorkspaceMenu(group.menuAgent), group.hasMenu);
  const marked = group.blockedCount > 0 || group.doneCount > 0;
  return (
    <section className="herd-group">
      <div className="group-head" style={indexedStyle(group.index)}>
        <Button
          ref={press}
          className="group-title"
          aria-expanded={!group.collapsed}
          aria-haspopup={group.hasMenu ? "menu" : undefined}
          onClick={() => actions.toggleGroup(group.id, groupIds)}
        >
          <Chevron className="group-chev" />
          <span className="group-name">{group.title}</span>
        </Button>
        <span className="group-marks">
          {group.blockedCount > 0 ? (
            <Button className="group-mark is-blocked"
              aria-label={t("list.markBlockedAria", { count: String(group.blockedCount) })}
              onClick={() => actions.revealAttention(group.id, "blocked")}>
              {t("list.markBlocked", { count: String(group.blockedCount) })}
            </Button>
          ) : null}
          {group.doneCount > 0 ? (
            <Button className="group-mark is-done"
              aria-label={t("list.markDoneAria", { count: String(group.doneCount) })}
              onClick={() => actions.revealAttention(group.id, "done")}>
              {t("list.markDone", { count: String(group.doneCount) })}
            </Button>
          ) : null}
          {!marked && group.count > 0 ? <span className="section-count">{group.count}</span> : null}
        </span>
        {group.canCreateTab ? (
          <Button className="icon-btn group-tool" aria-label={t("list.newTabIn", { workspace: group.title })}
            onClick={() => actions.createInWorkspace(group.menuAgent)}>
            <Plus size={18} aria-hidden="true" />
          </Button>
        ) : null}
        {group.hasMenu ? (
          <Button className="icon-btn group-tool" aria-haspopup="menu" aria-label={t("list.workspaceMenu", { workspace: group.title })}
            onClick={() => actions.openWorkspaceMenu(group.menuAgent)}>
            <MoreHorizontal size={18} aria-hidden="true" />
          </Button>
        ) : null}
        {group.path ? <span className="group-path">{group.path}</span> : null}
      </div>
      <div className="herd-group-body" hidden={group.collapsed}>
        {group.cards.map((card) => (
          <AgentCard key={card.paneId} card={card} actions={actions} />
        ))}
      </div>
    </section>
  );
}
