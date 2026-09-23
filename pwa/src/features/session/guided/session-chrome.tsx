import { ChevronDown, Ellipsis, FolderOpen, Square } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { agentMeta, agentStatusLabel, chromeName, tabIsSplit } from "../../../lib/dashboard";
import { t } from "../../../lib/i18n";
import type { AgentCard } from "../../../lib/ranking";
import { useDashboard } from "../../dashboard/hooks";
import { useConnection, useRuntime } from "../../connection/hooks";
import { TERM_MODE_LABEL } from "../../../lib/ui-model";
import type { ActiveTermMode } from "../../../lib/terminal-mode";
import { operationBusy } from "../../operations/capabilities-store";
import { haptic } from "../../../lib/dom";
import { canInterruptAgent, herdLiveness } from "../../connection/runtime-status";
import type { SessionHandlers } from "./view";
import { queueKey } from "./keys";
import { morphingPane, shareTitle } from "../../../app/transition";
import { BackButton, Button, StatusGlyph } from "../../../shared/ui/primitives";

/** Shared trailing actions for guided, terminal and agent chat chrome. */
export function SessionActions({ onWorkspace, onMenu, onStop, working }: {
  onWorkspace: () => void; onMenu: () => void; onStop: () => void; working: boolean;
}) {
  return <div className="chrome-actions">
    {working && <Button className="icon-btn icon-stop" aria-label={t("pane.interrupt")} title={t("pane.interruptTitle")}
      onClick={() => { haptic(10); onStop(); }}><Square size={14} fill="currentColor" aria-hidden="true" /></Button>}
    <Button className="icon-btn icon-workspace" aria-label={t("workspace.open")} title={t("workspace.open")}
      onClick={onWorkspace}><FolderOpen size={20} aria-hidden="true" /></Button>
    <Button className="icon-btn icon-more" aria-label={t("pane.menuTitle")} disabled={operationBusy()}
      onClick={onMenu}><Ellipsis size={20} aria-hidden="true" /></Button>
  </div>;
}

export function SessionChrome({ selected, includeBack, handlers, mode = "guided", fallbackTitle, fallbackDetail, onStop, working }: {
  selected?: AgentCard; includeBack: boolean; handlers: SessionHandlers;
  mode?: ActiveTermMode; fallbackTitle?: string; fallbackDetail?: string;
  onStop?: () => void; working?: boolean;
}) {
  const title = useRef<HTMLButtonElement>(null);
  const agents = useDashboard().agents;
  useConnection();
  useRuntime();
  const stale = herdLiveness() === "unverifiable";
  const status = selected ? (stale ? t("status.unverifiable") : agentStatusLabel(selected)) : "";
  const meta = selected ? [status, agentMeta(selected), tabIsSplit(selected, [...agents]) ? t("chrome.split") : ""].filter(Boolean).join(" · ") : fallbackDetail;
  const name = selected ? chromeName(selected) : fallbackTitle || t("title.session");
  const aria = meta ? t("chrome.switchAriaMeta", { title: name, line: meta }) : t("chrome.switchAria", { title: name });
  useLayoutEffect(() => {
    if (selected && morphingPane() === selected.paneId && title.current) shareTitle(title.current);
  });
  return <header className={`chrome session-chrome${mode === "full" ? " full-terminal-chrome" : ""}`} data-react-session-chrome="">
    <div className="chrome-primary">
      {includeBack && <BackButton onBack={handlers.onBack} label={t("chrome.backList")} />}
      <Button ref={title} className="chrome-title" title={aria} aria-label={aria} aria-haspopup="dialog" onClick={handlers.onSwitch}>
        <span className={`chrome-name${mode === "full" ? " full-terminal-title" : ""}`}>{name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
      <SessionActions onWorkspace={handlers.onWorkspace} onMenu={handlers.onMenu}
        working={!stale && (working ?? Boolean(selected && canInterruptAgent(selected.status)))} onStop={onStop ?? (() => queueKey("esc"))} />
    </div>
    <div className="chrome-secondary">
      <span className="chrome-meta" title={meta}>
        {selected && <StatusGlyph status={stale ? "unknown" : selected.status} small />}
        <span className={`chrome-meta-text${mode === "full" ? " full-terminal-status" : ""}`}>{meta}</span>
      </span>
      <Button className="chrome-mode" aria-haspopup="dialog" aria-label={`${t("mode.aria")} · ${TERM_MODE_LABEL[mode]}`}
        onClick={handlers.onMode}>
        {TERM_MODE_LABEL[mode]}<ChevronDown size={13} aria-hidden="true" />
      </Button>
    </div>
  </header>;
}
