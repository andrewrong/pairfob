import { useLayoutEffect, useRef, useState } from "react";
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
          {view.create.label}
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
  const revealFinished = useRef(false);
  useLayoutEffect(() => {
    if (!revealFinished.current) return;
    const target = root.current?.querySelector<HTMLElement>(".card.status-done .card-main");
    if (!target) return;
    revealFinished.current = false;
    target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, [finishedRequest, view]);
  const showFinished = () => {
    const collapsed = { ...preferencesStore.get().listGroupCollapsed };
    for (const group of view.groups) {
      if (group.cards.some((card) => card.agent.status === "done")) collapsed[group.id] = false;
    }
    setListGroupCollapsed(collapsed);
    revealFinished.current = true;
    setFinishedRequest((request) => request + 1);
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
        <CompletionCount count={view.doneCount} onActivate={showFinished} />
      </p>
      <HerdBanners tone={view.status.tone} />
      {variant === "page" ? <AppNotice /> : null}
      <HerdList view={view} actions={actions} />
    </>
  );
  const bindRoot = (node: HTMLElement | null) => { root.current = node; };
  return variant === "rail" ? <aside ref={bindRoot} className="rail">{chrome}</aside> : <div ref={bindRoot} className="page">{chrome}</div>;
}
