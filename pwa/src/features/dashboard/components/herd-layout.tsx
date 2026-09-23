import { ChevronRight, Ellipsis, Plus } from "lucide-react";
import { t } from "../../../lib/i18n";
import { Button, EmptyState, StatusGlyph } from "../../../shared/ui/primitives";
import type { HerdActions } from "../actions";
import type { HerdLayoutSection, HerdLayoutTab } from "../model/herd-layout";
import type { HerdEmptyView } from "../model/herd-view";

const pct = (value: number) => `${Math.max(0, Math.min(100, value * 100)).toFixed(3)}%`;

/**
 * One tab as its real split: each cell opens that session, the caption opens
 * the tab's full, zoomable layout. Cells and caption are siblings, never nested.
 */
function TabThumb({ section, tab, actions }: { section: HerdLayoutSection; tab: HerdLayoutTab; actions: HerdActions }) {
  return (
    <div className="layout-tab">
      <div className="layout-thumb" role="group" aria-label={t("board.canvasAria")}>
        {tab.panes.map((pane) => (
          <Button
            key={pane.paneId}
            className={`layout-cell status-${pane.status}`}
            style={{ left: pct(pane.x), top: pct(pane.y), width: pct(pane.w), height: pct(pane.h) }}
            aria-label={t("board.paneAria", { title: pane.title })}
            title={pane.statusText ? `${pane.title} · ${pane.statusText}` : pane.title}
            onClick={() => actions.openPaneFromCard(pane.paneId, null)}
          >
            <StatusGlyph status={pane.status} small />
            <span className="layout-cell-title">{pane.title}</span>
          </Button>
        ))}
      </div>
      <Button className="layout-tab-caption" onClick={() => actions.openTabLayout(section.workspaceId, tab.tabId)}>
        <span className="layout-tab-name">{tab.label}</span>
        <span className="layout-tab-meta">{t("detail.splitCount", { n: tab.paneCount })}</span>
        <ChevronRight size={14} aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * The home "layout" view: every workspace, and each of its tabs drawn as the
 * split the computer really shows. It replaces a separate board page as the way
 * in; the full board opens from a tab caption.
 */
export function HerdLayoutView({ sections, empty, actions }: {
  sections: HerdLayoutSection[];
  empty: HerdEmptyView | null;
  actions: HerdActions;
}) {
  if (!sections.length) {
    const spec = empty
      ? { title: empty.title, sub: empty.sub, figure: "grid" as const }
      : { title: t("board.emptyTitle"), sub: t("board.empty"), figure: "grid" as const };
    return <EmptyState spec={spec} />;
  }
  return (
    <div className="herd-layout">
      {sections.map((section) => (
        <section key={section.workspaceId} className="layout-space" aria-label={section.title}>
          <div className="layout-space-head">
            <h2 className="layout-space-title">{section.title}</h2>
            <span className="layout-space-meta">{t("home.tabCount", { count: String(section.tabs.length) })}</span>
            {section.anchor ? (
              <Button className="icon-btn group-more" aria-haspopup="menu" aria-label={t("home.cardMenu", { title: section.title })}
                onClick={() => actions.openWorkspaceMenu(section.anchor)}>
                <Ellipsis size={18} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <div className="layout-strip">
            {section.tabs.map((tab) => <TabThumb key={tab.tabId} section={section} tab={tab} actions={actions} />)}
            {section.canCreateTab && section.anchor ? (
              <Button className="layout-tab-new" aria-label={t("menu.newTabInWorkspace")} onClick={() => actions.createTabIn(section.anchor)}>
                <Plus size={18} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </section>
      ))}
      <p className="layout-hint">{t("home.layoutHint")}</p>
    </div>
  );
}
