import { ChevronDown, Folder, Minus, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { BackButton, Button, StatusLine } from "../../../shared/ui/primitives";
import { MenuChoice, showActionSheet } from "../../../shared/ui/overlay";
import { t } from "../../../lib/i18n";
// AppNotice is the connected App notice (chrome barrel seam); HerdBanners is the
// connection feature's own pure banner component.
import { AppNotice } from "../../../app/notice";
import { HerdBanners } from "../../../features/connection/herd-banners";
import type { BoardSpaceView, BoardViewModel } from "../model/board-view";
import { scheduleRailVisibility } from "../rail/visibility";
import { BoardCanvasView, type BoardCanvasController } from "./board-canvas";

/** Narrow intents the board chrome can fire; the page binds them to actions. */
export type BoardScreenActions = {
  back(): void;
  selectWorkspace(workspaceId: string): void;
  selectTab(tabId: string): void;
  createTab(): void;
  fit(): void;
  zoom(direction: 1 | -1): void;
};

function SpaceMarks({ space }: { space: BoardSpaceView }) {
  return <>
    {space.blockedCount > 0 ? <span className="group-mark is-blocked">{t("list.markBlocked", { count: String(space.blockedCount) })}</span> : null}
    {space.doneCount > 0 ? <span className="group-mark is-done">{t("list.markDone", { count: String(space.doneCount) })}</span> : null}
  </>;
}

/** The workspace switcher behind the board title, with the same marks as the list. */
function openWorkspaceSheet(view: BoardViewModel, select: (workspaceId: string) => void): void {
  showActionSheet(view.spaceAria, (modal) => (
    <>
      {view.spaces.map((space) => (
        <MenuChoice key={space.id} modal={modal} icon={<Folder size={18} aria-hidden="true" />}
          title={space.label}
          detail={space.path || space.blockedCount || space.doneCount
            ? <><SpaceMarks space={space} />{space.path ? <span className="mono">{space.path}</span> : null}</>
            : undefined}
          selected={space.selected}
          action={space.selected ? undefined : () => select(space.id)} />
      ))}
      {!view.spaces.length ? <p className="empty-sub">{view.spacesEmpty}</p> : null}
    </>
  ));
}

/**
 * Board screen presentation.
 *
 * Everything it shows comes from `view`; everything it does goes through
 * `actions` and `controller`. The title is the selected workspace and opens the
 * workspace switcher; one rail holds that workspace's tabs; zoom floats over the
 * canvas within thumb reach. On a phone tab root there is no back button — the
 * tab bar leaves the board — while the desktop keeps back and the status line.
 * The two DOM lifecycles it owns are explicit effects with cleanup: rail
 * measurement after each commit, and releasing the remote scroll controller
 * when the board is really being left.
 */
export function BoardScreenView({
  view,
  actions,
  controller,
  showBack = true,
}: {
  view: BoardViewModel;
  actions: BoardScreenActions;
  controller: BoardCanvasController;
  showBack?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRailRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() =>
    scheduleRailVisibility({
      root: rootRef.current,
      spaceRail: null,
      spaces: null,
      tabRail: tabRailRef.current,
      tabs: tabsRef.current,
    }),
  );
  // Owned per setup: a replaced controller releases its own scroll lifetime.
  useEffect(() => () => controller.releaseScrollOnLeave(), [controller]);
  const space = view.workspace;
  return (
    <div ref={rootRef} className="board-shell">
      <header className="board-chrome">
        {showBack ? <BackButton onBack={actions.back} label={view.back} /> : <h1 className="sr-only">{view.title}</h1>}
        <Button className="board-ws" aria-haspopup="dialog"
          onClick={() => openWorkspaceSheet(view, actions.selectWorkspace)}>
          <span className="board-ws-mark" aria-hidden="true" />
          <span className="board-ws-text">
            <span className="board-ws-name">{space?.label ?? view.title}<ChevronDown size={16} aria-hidden="true" /></span>
            {space?.path ? <span className="board-ws-path">{space.path}</span> : null}
          </span>
        </Button>
        {space ? <span className="board-marks"><SpaceMarks space={space} /></span> : null}
      </header>
      {showBack ? <StatusLine status={view.status} /> : null}
      <HerdBanners tone={view.status.tone} />
      <AppNotice />
      <div ref={tabRailRef} className="board-rail">
        <div ref={tabsRef} className="board-tabs" role="tablist" aria-label={view.tabAria}>
          {view.tabs.map((tab) => (
            <Button
              key={tab.id}
              className={`board-tab${tab.selected ? " on" : ""}`}
              role="tab"
              aria-selected={tab.selected}
              onClick={() => actions.selectTab(tab.id)}
            >
              <span>{tab.label}{tab.attention ? <>
                <i className={`board-tab-dot is-${tab.attention}`} aria-hidden="true" />
                <span className="sr-only">{t(tab.attention === "blocked" ? "board.tabWaiting" : "board.tabDone")}</span>
              </> : null}</span>
            </Button>
          ))}
          {view.create ? (
            <Button className="board-tab-new" disabled={view.create.disabled} onClick={actions.createTab}>
              <span>{view.create.label}</span>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="board-body">
        <BoardCanvasView canvas={view.canvas} controller={controller} />
        <div className="board-zoom" role="group" aria-label={t("board.zoomGroup")}>
          <Button className="icon-btn" aria-label={view.zoom.in} onClick={() => actions.zoom(1)}><Plus size={20} aria-hidden="true" /></Button>
          <Button className="board-zoom-fit" aria-label={view.zoom.fit} onClick={actions.fit}>{view.zoom.fitLabel}</Button>
          <Button className="icon-btn" aria-label={view.zoom.out} onClick={() => actions.zoom(-1)}><Minus size={20} aria-hidden="true" /></Button>
        </div>
      </div>
    </div>
  );
}
