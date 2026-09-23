import { ChevronDown, LayoutGrid, List, Plus, Settings2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { Button, StatusDot, TopbarActions } from "../../../shared/ui/primitives";
import { prefersReducedMotion } from "../../../shared/ui/dom/motion";
import { preferencesStore, setListGroupCollapsed } from "../../settings/preferences-store";
// AppNotice is the connected App notice (chrome barrel seam); HerdBanners is the
// connection feature's own pure banner component.
import { AppNotice } from "../../../app/notice";
import { HerdBanners } from "../../../features/connection/herd-banners";
import { CompletionCount } from "./herd-controls";
import type { HerdActions } from "../actions";
import type { HerdViewModel } from "../model/herd-view";
import { HerdLayoutView } from "./herd-layout";
import { HerdList } from "./herd-list";

/**
 * Top row: which computer this is and whether it is reachable (tap to switch
 * computers), and settings. Everything else a thumb needs lives at the bottom.
 */
function HerdTopbar({ view, actions }: { view: HerdViewModel; actions: HerdActions }) {
  return (
    <div className="topbar herd-topbar">
      <Button className="herd-computer" aria-label={t("home.computerAria", { status: view.status.text })} onClick={actions.openComputers}>
        <StatusDot tone={view.status.tone} />
        <span className="herd-computer-text">{view.status.text}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
      <TopbarActions className="herd-topbar-actions">
        <Button className="icon-btn herd-settings" aria-label={view.settings.label} onClick={actions.openSettings}>
          <Settings2 size={20} aria-hidden="true" />
        </Button>
      </TopbarActions>
    </div>
  );
}

function HerdViewToggle({ view, actions }: { view: HerdViewModel; actions: HerdActions }) {
  const options = [
    { id: "list" as const, label: t("home.viewList"), icon: <List size={14} aria-hidden="true" /> },
    { id: "layout" as const, label: t("home.viewLayout"), icon: <LayoutGrid size={14} aria-hidden="true" /> },
  ];
  return (
    <div className="herd-view-toggle" role="radiogroup" aria-label={t("home.viewAria")}>
      {options.map((option) => (
        <Button
          key={option.id}
          role="radio"
          aria-checked={view.homeView === option.id}
          className={`herd-view-option${view.homeView === option.id ? " on" : ""}`}
          onClick={() => actions.setHomeView(option.id)}
        >{option.icon}{option.label}</Button>
      ))}
    </div>
  );
}

function HerdCreateBar({ view, actions }: { view: HerdViewModel; actions: HerdActions }) {
  if (!view.create) return null;
  return (
    <div className="herd-create-bar">
      <Button
        className="topbar-create herd-create"
        onClick={actions.createConversation}
        disabled={view.create.disabled}
        aria-label={view.create.aria}
      >
        <span className="herd-create-plus"><Plus size={16} aria-hidden="true" /></span>
        <span className="herd-create-label">{view.create.label}</span>
      </Button>
    </div>
  );
}

/**
 * The herd surface: computer and settings, the list or layout view, and the
 * create bar at the bottom where a thumb reaches it.
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
    // Counts point into the list; from the layout view they bring the list back.
    if (view.homeView !== "list") actions.setHomeView("list");
    const previous = candidates.findIndex(card => card.paneId === lastLocated.current[status]);
    const next = candidates[(previous + 1) % candidates.length];
    lastLocated.current[status] = next.paneId;
    revealPane.current = next.paneId;
    setListGroupCollapsed({ ...preferencesStore.get().listGroupCollapsed, [next.groupId]: false });
    setFinishedRequest(request => request + 1);
  };
  const chrome = (
    <>
      <HerdTopbar view={view} actions={actions} />
      <div className="herd-heading">
        <h1 className="herd-title">{t("group.sessions")}</h1>
        <HerdViewToggle view={view} actions={actions} />
      </div>
      <p className="statusline herd-summary">
        <span className="statusline-text">{t("home.sessionCount", { count: String(view.sessionCount) })}</span>
        <span className="attention-counts">
          {view.pendingCount > 0 && <Button className="text-link pending-count"
            aria-label={t("home.pendingCountAria", { count: String(view.pendingCount) })} onClick={() => showNext("blocked")}>
            {t("home.pendingCount", { count: String(view.pendingCount) })}
          </Button>}
          <CompletionCount count={view.doneCount} onActivate={() => showNext("done")} />
        </span>
        {view.homeView === "list" ? (
          <Button className="text-link herd-grouping" aria-haspopup="dialog" onClick={actions.chooseGrouping}>
            {t("home.grouping", { name: view.grouping.label })}<ChevronDown size={13} aria-hidden="true" />
          </Button>
        ) : null}
      </p>
      <HerdBanners tone={view.status.tone} />
      {variant === "page" ? <AppNotice /> : null}
      <div className="herd-body">
        {view.homeView === "layout" && view.layout
          ? <HerdLayoutView sections={view.layout} empty={view.empty} actions={actions} />
          : <HerdList view={view} actions={actions} />}
      </div>
      <HerdCreateBar view={view} actions={actions} />
    </>
  );
  const bindRoot = (node: HTMLElement | null) => { root.current = node; };
  return variant === "rail"
    ? <aside ref={bindRoot} className="rail herd-screen">{chrome}</aside>
    : <div ref={bindRoot} className="page herd-screen">{chrome}</div>;
}
