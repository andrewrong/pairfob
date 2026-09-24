import { Check, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { t } from "../../../lib/i18n";
import { AgentAvatar, Button } from "../../../shared/ui/primitives";
import { useObjectPress } from "../../../shared/ui/overlay";
import type { HerdActions } from "../actions";
import type { HerdCardView } from "../model/herd-view";
import { indexedStyle } from "./indexed";
import { bindSwipeRow } from "./swipe-row";

/** Trailing actions a left swipe reveals: pin and the full menu. */
const TRAILING_WIDTH = 144;

/**
 * One session row.
 *
 * A tap opens the pane and the row grows into it (`app/transition` names the
 * row's avatar and title for that one navigation). A hold (or right-click)
 * opens the object menu. On a touch screen a left swipe reveals pin / more, and
 * a right swipe marks an unread completion as read; every swipe action is also
 * in the menu.
 */
export function AgentCard({ card, actions }: { card: HerdCardView; actions: HerdActions }) {
  const title = useRef<HTMLSpanElement>(null);
  const row = useRef<HTMLElement>(null);
  const press = useObjectPress(() => actions.openPaneMenu(card.agent));
  const unread = useRef(card.unread);
  unread.current = card.unread;
  const paneId = card.paneId;
  useLayoutEffect(() => {
    if (!row.current) return;
    return bindSwipeRow(row.current, {
      foreground: () => press.current,
      trailingWidth: TRAILING_WIDTH,
      canCommitRight: () => unread.current,
      onCommitRight: () => actions.markRead(paneId),
    });
  }, [actions, paneId, press]);
  const classes = [card.className, card.kind === "terminal" ? "is-terminal" : "",
    card.blocked ? "is-blocked" : "", card.unread ? "is-unread" : ""].filter(Boolean).join(" ");
  return (
    <article ref={row} className={classes} style={indexedStyle(card.index)}>
      <div className="card-actions" aria-hidden="true">
        {card.unread ? (
          <button type="button" tabIndex={-1} className="card-action is-read" onClick={() => actions.markRead(paneId)}>
            <Check size={18} aria-hidden="true" />{t("list.swipeRead")}
          </button>
        ) : null}
        <button type="button" tabIndex={-1} className="card-action is-pin" onClick={() => actions.togglePin(paneId)}>
          {card.pinned ? <PinOff size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}
          {card.pinned ? t("list.swipeUnpin") : t("list.swipePin")}
        </button>
        <button type="button" tabIndex={-1} className="card-action is-more" onClick={() => actions.openPaneMenu(card.agent)}>
          <MoreHorizontal size={18} aria-hidden="true" />{t("list.swipeMore")}
        </button>
      </div>
      <Button
        ref={press}
        className="card-main"
        data-pane-id={paneId}
        aria-pressed={card.selected}
        aria-haspopup="menu"
        onClick={() => actions.openPaneFromCard(paneId, title.current)}
      >
        <AgentAvatar kind={card.kind === "agent" ? card.agentKind : ""}
          status={card.kind === "agent" ? card.statusTone : undefined} />
        <span className="card-copy">
          <span className="card-title" ref={title}>
            {card.pinned ? <>
              <Pin className="pin-mark" size={12} aria-hidden="true" />
              <span className="sr-only">{card.pinnedLabel}</span>
            </> : null}
            <span className="card-name">{card.title}</span>
          </span>
          <span className="card-meta">
            {card.statusLabel ? <span className={`card-status is-${card.statusTone}`}>{card.statusLabel}</span> : null}
            {card.statusLabel && card.line ? <span aria-hidden="true"> · </span> : null}
            {card.line}
          </span>
        </span>
        <span className="card-side">
          {card.ago ? <span className="card-ago">{card.ago}</span> : null}
          {card.blocked || card.unread ? <span className={`card-dot${card.blocked ? " is-blocked" : ""}`} aria-hidden="true" /> : null}
        </span>
      </Button>
    </article>
  );
}
