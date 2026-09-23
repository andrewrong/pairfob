import { agentDisplaySummary } from "../../../lib/agent-inspect";
import { Ellipsis, Pin, PinOff } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { Button, Chevron, StatusGlyph } from "../../../shared/ui/primitives";
import { useObjectPress } from "../../../shared/ui/overlay";
import type { HerdActions } from "../actions";
import type { HerdCardView } from "../model/herd-view";
import { indexedStyle } from "./indexed";
import { bindRowSwipe, type RowSwipe } from "./row-swipe";

/**
 * One session row.
 *
 * A single control: tap opens the pane, a hold opens the object menu, and a
 * swipe left reveals "pin" and "more" (the same pin and the same menu). The
 * leading glyph carries the status by shape and colour, all states with the
 * same weight; the words sit at the start of the meta line.
 */
export function AgentCard({ card, actions }: { card: HerdCardView; actions: HerdActions }) {
  const row = useRef<HTMLElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const swipe = useRef<RowSwipe | null>(null);
  const [revealed, setRevealed] = useState(false);
  const press = useObjectPress(() => actions.openPaneMenu(card.agent));
  useLayoutEffect(() => {
    const slide = press.current;
    if (!row.current || !slide) return;
    const bound = bindRowSwipe(row.current, slide, () => trail.current?.offsetWidth || 152, setRevealed);
    swipe.current = bound;
    return () => {
      bound.destroy();
      swipe.current = null;
    };
  }, [press]);
  const summary = agentDisplaySummary(card.agent);
  const after = (run: () => void) => () => {
    swipe.current?.close();
    run();
  };
  return (
    <article ref={row} className={card.className} style={indexedStyle(card.index)}>
      <div ref={trail} className="card-trail" aria-hidden={!revealed}>
        <Button className="card-trail-act" tabIndex={revealed ? 0 : -1} onClick={after(() => actions.togglePin(card.agent))}>
          {card.pinned ? <PinOff size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}
          <span>{t(card.pinned ? "menu.unpin" : "menu.pin")}</span>
        </Button>
        <Button className="card-trail-act" tabIndex={revealed ? 0 : -1} onClick={after(() => actions.openPaneMenu(card.agent))}>
          <Ellipsis size={18} aria-hidden="true" />
          <span>{t("menu.more")}</span>
        </Button>
      </div>
      <Button
        ref={press}
        className="card-main"
        data-pane-id={card.paneId}
        aria-pressed={card.selected}
        aria-haspopup="menu"
        onClick={() => actions.openPaneFromCard(card.paneId, title.current)}
      >
        <StatusGlyph status={card.glyph} />
        <div className="card-copy">
          <div
            className="card-title"
            ref={title}
            style={card.sharesTransition ? { viewTransitionName: "pane-title" } : undefined}
          >
            <span className="card-name">{card.title}</span>
            {card.pinned && (
              <>
                <Pin className="pin-mark" size={12} aria-hidden="true" />
                <span className="sr-only">{card.pinnedLabel}</span>
              </>
            )}
          </div>
          <p className="card-meta">
            {card.pill && <span className={`${card.pill.className} card-status`}>{card.pill.text}</span>}
            {card.meta && <span className="card-where">{card.meta}</span>}
          </p>
          {summary && <p className="card-meta card-summary">{summary}</p>}
        </div>
        <Chevron />
      </Button>
    </article>
  );
}
