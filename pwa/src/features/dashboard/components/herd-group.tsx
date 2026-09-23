import { Ellipsis } from "lucide-react";
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
 * The heading toggles the section and, for a workspace group that really has a
 * workspace id, also carries the workspace object menu — on a hold, and on the
 * visible "···" beside it so the menu is discoverable without knowing the hold.
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
  return (
    <section className="herd-group">
      <div className="group-head">
      <Button
        ref={press}
        className="group-title"
        aria-expanded={!group.collapsed}
        aria-haspopup={group.hasMenu ? "menu" : undefined}
        style={indexedStyle(group.index)}
        onClick={() => actions.toggleGroup(group.id, groupIds)}
      >
        <Chevron className="group-chev" />
        <span className="group-name">{group.title}</span>
        {group.count > 0 && <span className="section-count">{group.count}</span>}
      </Button>
      {group.hasMenu && (
        <Button className="icon-btn group-more" aria-label={t("home.cardMenu", { title: group.title })} aria-haspopup="menu"
          onClick={() => actions.openWorkspaceMenu(group.menuAgent)}>
          <Ellipsis size={18} aria-hidden="true" />
        </Button>
      )}
      </div>
      <div className="herd-group-body" hidden={group.collapsed}>
        {group.cards.map((card) => (
          <AgentCard key={card.paneId} card={card} actions={actions} />
        ))}
      </div>
    </section>
  );
}
