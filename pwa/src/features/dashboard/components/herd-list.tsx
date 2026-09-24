import { WorktreeProgressList } from "../../operations/worktree-progress";
// Not this slice: the daemon update banner stays with its own owner. The phone
// shows it in Settings; the desktop rail keeps the compact notice.
import { DaemonUpdate } from "../../settings/daemon-update-view";
import { ListGroupControl } from "./herd-controls";
import type { HerdActions } from "../actions";
import type { HerdViewModel } from "../model/herd-view";
import { AgentCard } from "./agent-card";
import { HerdGroup } from "./herd-group";
import { HerdSkeleton } from "./herd-skeleton";
import { HerdEmpty } from "./herd-empty";
import { indexedStyle } from "./indexed";

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
  return (
    <>
      {variant === "rail" ? <DaemonUpdate compact /> : null}
      <WorktreeProgressList />
      {variant === "rail" ? <ListGroupControl /> : null}
      {view.loading ? <HerdSkeleton /> : view.empty ? <HerdEmpty empty={view.empty} actions={actions} /> : (
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
