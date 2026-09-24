import { t } from "../../../lib/i18n";

/**
 * Placeholder rows while nothing has been read yet. They borrow the real
 * list's group and row boxes, so the first snapshot replaces them in place
 * with no jump. Screen readers hear one status line instead of empty shapes.
 */
const GROUPS = [
  { head: [120, 118], rows: [[70, 46], [56, 38], [64, 52]] },
  { head: [96, 104], rows: [[62, 44], [52, 40]] },
];

/** `still`: nothing is loading (offline / reconnecting), so no sheen and no status. */
export function HerdSkeleton({ still = false }: { still?: boolean }) {
  return (
    <div className={`herd-list herd-skeleton${still ? " is-still" : ""}`} role={still ? undefined : "status"}
      aria-busy={still ? undefined : true} aria-hidden={still ? true : undefined}>
      {still ? null : <span className="sr-only">{t("list.loading")}</span>}
      {GROUPS.map((group, gi) => (
        <section key={gi} className="herd-group" aria-hidden="true">
          <div className="group-head herd-sk-head">
            <span className="herd-sk" style={{ width: group.head[0], height: 14 }} />
            <span className="herd-sk" style={{ width: group.head[1], height: 10 }} />
          </div>
          <div className="herd-group-body">
            {group.rows.map(([title, meta], ri) => (
              <div key={ri} className="card-main herd-sk-row">
                <span className="herd-sk herd-sk-avatar" />
                <span className="card-copy">
                  <span className="herd-sk" style={{ width: `${title}%`, height: 14 }} />
                  <span className="herd-sk" style={{ width: `${meta}%`, height: 10 }} />
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
