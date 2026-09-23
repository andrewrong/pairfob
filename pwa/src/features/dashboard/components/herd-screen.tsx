import { CircleAlert, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { Brand, Button, StatusDot, TopbarActions } from "../../../shared/ui/primitives";
import { prefersReducedMotion } from "../../../shared/ui/dom/motion";
import { preferencesStore, setListGroupCollapsed } from "../../settings/preferences-store";
// AppNotice is the connected App notice (chrome barrel seam); HerdBanners is the
// connection feature's own pure banner component.
import { AppNotice } from "../../../app/notice";
import { HerdBanners } from "../../../features/connection/herd-banners";
import { CompletionCount } from "./herd-controls";
import type { HerdActions } from "../actions";
import type { HerdViewModel } from "../model/herd-view";
import { HerdList } from "./herd-list";

function HerdTopActions({ view, actions }: { view: HerdViewModel; actions: HerdActions }) {
  return (
    <TopbarActions className="herd-topbar-actions">
      {view.create && (
        <Button
          className="topbar-create"
          onClick={actions.createConversation}
          disabled={view.create.disabled}
          aria-label={view.create.aria}
        >
          <Plus size={16} aria-hidden="true" />{view.create.label}
        </Button>
      )}
      {view.computers && (
        <Button className="text-link" onClick={actions.openComputers}>{view.computers.label}</Button>
      )}
      <Button className="text-link" onClick={actions.openBoard}>{view.board.label}</Button>
      <Button className="text-link" onClick={actions.openSettings}>{view.settings.label}</Button>
    </TopbarActions>
  );
}

/**
 * The herd surface: topbar, status line, banners and the list.
 *
 * `variant` is the only difference between the phone page and the desktop rail —
 * the rail deliberately shows no app notice, because the desktop main pane owns
 * notices for the open session.
 */
export function HerdScreen({
  view,
  actions,
  variant,
}: {
  view: HerdViewModel;
  actions: HerdActions;
  variant: "page" | "rail";
}) {
  const [finishedRequest, setFinishedRequest] = useState(0);
  const root = useRef<HTMLElement>(null);
  const revealPane = useRef<string | null>(null);
  const lastLocated = useRef({ blocked: "", done: "" });
  useLayoutEffect(() => {
    if (!revealPane.current) return;
    if (!view.groups.some(group => !group.collapsed && group.cards.some(card => card.paneId === revealPane.current))) return;
    const target = [...(root.current?.querySelectorAll<HTMLElement>(".card-main[data-pane-id]") ?? [])]
      .find(node => node.dataset.paneId === revealPane.current);
    if (!target) return;
    revealPane.current = null;
    target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, [finishedRequest, view]);
  const showNext = (status: "blocked" | "done") => {
    const candidates = view.groups.flatMap(group => group.cards
      .filter(card => card.agent.status === status).map(card => ({ paneId: card.paneId, groupId: group.id })));
    if (!candidates.length) return;
    const previous = candidates.findIndex(card => card.paneId === lastLocated.current[status]);
    const next = candidates[(previous + 1) % candidates.length];
    lastLocated.current[status] = next.paneId;
    revealPane.current = next.paneId;
    setListGroupCollapsed({ ...preferencesStore.get().listGroupCollapsed, [next.groupId]: false });
    setFinishedRequest(request => request + 1);
  };
  const chrome = (
    <>
      <div className="topbar herd-topbar">
        <Brand tone={view.status.tone} heading />
        <HerdTopActions view={view} actions={actions} />
      </div>
      <p className="statusline">
        <StatusDot tone={view.status.tone} />
        <span className="statusline-text">{view.status.text}</span>
        <span className="attention-counts">
        {view.pendingCount > 0 && <Button className="text-link pending-count"
          aria-label={t("home.pendingCountAria", { count: String(view.pendingCount) })} onClick={() => showNext("blocked")}>
          <CircleAlert size={14} aria-hidden="true" />{t("home.pendingCount", { count: String(view.pendingCount) })}
        </Button>}
        <CompletionCount count={view.doneCount} onActivate={() => showNext("done")} />
        </span>
      </p>
      <HerdBanners tone={view.status.tone} />
      {variant === "page" ? <AppNotice /> : null}
      <HerdList view={view} actions={actions} />
    </>
  );
  const bindRoot = (node: HTMLElement | null) => { root.current = node; };
  return variant === "rail" ? <aside ref={bindRoot} className="rail">{chrome}</aside> : <div ref={bindRoot} className="page">{chrome}</div>;
}
