import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { BackBar, Brand, Button, SelectionRow } from "../../shared/ui/primitives";
import type { ComputersViewModel } from "./model";

/**
 * The computer picker list. Pure: every string and the back target arrive in the
 * view model, mutations are callbacks the caller owns, and chrome the page still
 * hosts (`AppNotice`, daemon-update help) arrives as slots.
 */
export function ComputerListView({ view, onSwitch, onForget, onAdd, onBack, notice, footer }: {
  view: ComputersViewModel;
  onSwitch: (daemonId: string) => void;
  onForget: (daemonId: string) => void;
  onAdd: () => void;
  onBack: () => void;
  notice?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      {view.withBack ? (
        <BackBar title={view.backTitle} onBack={onBack} />
      ) : (
        <>
          <Brand />
          <h1 className="prelude-title">{view.heading?.title}</h1>
          <p className="lede">{view.heading?.lede}</p>
        </>
      )}
      {notice}
      <div className="computer-list">
        {view.rows.map(row => (
          <div className="computer-row" key={row.daemonId}>
            <SelectionRow selected={row.current} onClick={() => onSwitch(row.daemonId)}
              title={row.title} description={row.meta}
              badge={row.currentPill ? <span className="pill pill-live">{row.currentPill}</span> : null} />
            <Button className="computer-forget" aria-label={row.forgetAria} onClick={() => onForget(row.daemonId)}>{row.forgetLabel}</Button>
          </div>
        ))}
      </div>
      <SelectionRow className="computer-add" onClick={onAdd} title={view.addLabel} description={view.addHint}
        leading={<span className="add-mark" aria-hidden="true"><Plus size={18} /></span>} />
      {footer}
    </>
  );
}
