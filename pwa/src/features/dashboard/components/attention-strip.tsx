import { t } from "../../../lib/i18n";
import { AgentAvatar, Button } from "../../../shared/ui/primitives";
import type { HerdAttentionItem } from "../model/herd-view";

/**
 * "Needs you" shortcuts. Each ticket opens its pane directly; the rows stay in
 * their own workspace, so this strip never changes the list's structure. It is
 * absent when nothing waits on the reader. The outer wrapper is what the header
 * collapses while it folds, so the strip can shrink away instead of vanishing.
 */
export function AttentionStrip({ items, onOpen, hidden = false }: {
  items: readonly HerdAttentionItem[];
  onOpen: (paneId: string) => void;
  /** Folded away with the header: still laid out for the transition, not reachable. */
  hidden?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="attn-wrap" aria-hidden={hidden || undefined} inert={hidden || undefined}>
      <div className="attn-strip" role="group" aria-label={t("list.needsYouAria")}>
        <span className="attn-strip-label">
          {t("list.needsYouTitle")}
          <span className="attn-count">{items.length}</span>
        </span>
        {items.map((item) => (
          <Button key={item.paneId} className={`attn-ticket is-${item.kind}`} onClick={() => onOpen(item.paneId)}>
            <AgentAvatar kind={item.agentKind} size="sm" />
            <span className="attn-ticket-name">{item.title}</span>
            {item.workspace ? <span className="attn-ticket-ws">{item.workspace}</span> : null}
            <span className={`attn-ticket-dot is-${item.kind}`} aria-hidden="true" />
          </Button>
        ))}
      </div>
    </div>
  );
}
