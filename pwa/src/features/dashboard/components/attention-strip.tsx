import { t } from "../../../lib/i18n";
import { AgentAvatar, Button } from "../../../shared/ui/primitives";
import type { HerdAttentionItem } from "../model/herd-view";

/**
 * "Needs you" shortcuts. Each ticket opens its pane directly; the rows stay in
 * their own workspace, so this strip never changes the list's structure. It is
 * absent when nothing waits on the reader.
 */
export function AttentionStrip({ items, onOpen }: {
  items: readonly HerdAttentionItem[];
  onOpen: (paneId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="attn-strip" role="group" aria-label={t("list.needsYouAria")}>
      <span className="attn-strip-label">{t("list.needsYou", { count: String(items.length) })}</span>
      {items.map((item) => (
        <Button key={item.paneId} className={`attn-ticket is-${item.kind}`} onClick={() => onOpen(item.paneId)}>
          <span className={`attn-ticket-dot is-${item.kind}`} aria-hidden="true" />
          <AgentAvatar kind={item.agentKind} size="sm" />
          <span className="attn-ticket-name">{item.title}</span>
          {item.workspace ? <span className="attn-ticket-ws">{item.workspace}</span> : null}
        </Button>
      ))}
    </div>
  );
}
