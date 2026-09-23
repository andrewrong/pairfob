import { EmptyState } from "../../../shared/ui/primitives";
import { WorktreeProgressList } from "../../operations/worktree-progress";
// Not this slice: the daemon update banner stays with its own owner. The phone
// shows it in Settings; the desktop rail keeps the compact notice.
import { DaemonUpdate } from "../../settings/daemon-update-view";
import { ListGroupControl } from "./herd-controls";
import type { HerdActions } from "../actions";
import type { HerdViewModel } from "../model/herd-view";
import { AgentCard } from "./agent-card";
import { HerdGroup } from "./herd-group";
import { indexedStyle } from "./indexed";

function emptySpec(view: HerdViewModel, actions: HerdActions) {
  const empty = view.empty;
  if (!empty) return null;
  const action = empty.action;
  return {
    title: empty.title,
    sub: empty.sub,
    figure: "panes" as const,
    action: action
      ? { label: action.label, disabled: action.disabled, run: () => actions.runEmptyAction(action.kind) }
      : undefined,
  };
}

/**
 * The herd list: pending worktree jobs, then either the empty state or the
 * projected sections. The desktop rail also carries the compact daemon update
 * and the grouping control; the phone page moves both to the header / Settings.
 */
export function HerdList({ view, actions, variant = "page" }: {
  view: HerdViewModel;
  actions: HerdActions;
  variant?: "page" | "rail";
}) {
  const groups = view.groups;
  const empty = emptySpec(view, actions);
  return (
    <>
      {variant === "rail" ? <DaemonUpdate compact /> : null}
      <WorktreeProgressList />
      {variant === "rail" ? <ListGroupControl /> : null}
      {empty ? <EmptyState spec={empty} /> : (
        <div className={`herd-list${view.stagger ? " enter" : ""}`}>
          {groups.map((group) => view.grouped ? (
            <HerdGroup key={group.id} group={group} groupIds={groups.map((item) => item.id)} actions={actions} />
          ) : (
            <section key={group.id} className="herd-group">
              <h2 className="section-title" style={indexedStyle(group.index)}>{group.title}
                {group.count > 0 && <span className="section-count">{group.count}</span>}
              </h2>
              <div className="herd-group-body">
                {group.cards.map((card) => <AgentCard key={card.paneId} card={card} actions={actions} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
