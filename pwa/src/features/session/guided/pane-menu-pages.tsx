import { Folder, Plus, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "../../../lib/i18n";
import { OPERATION_INPUT_LIMITS, type SplitDirection } from "../../../lib/operations";
import { agentTitle, type DashboardAgentCard as AgentCard } from "../../../lib/dashboard";
import { advertisedAgentKinds } from "../../operations/capabilities-store";
import { createSelectedTab, renamePaneTo, splitSelectedPane, type SheetOutcome } from "../../operations/controller";
import { useCapabilities } from "../../operations/hooks";
import { AgentKindGrid, kindName } from "../../operations/agent-kind-grid";
import { AgentKindPickerPanel } from "../../operations/agent-kind-picker";
import { loadCreateMemory, rememberCreate } from "../../operations/create-memory";
import { loadLastAgentKind } from "../../operations/operation-form-model";
import { useConnection } from "../../connection/hooks";
import { liveSession } from "../../computers/catalog-store";
import { usePreferences } from "../../settings/hooks";
import { useDashboard } from "../../dashboard/hooks";
import { cellStyle, layoutBoxes, layoutRatio, useTabLayout, type CellBox } from "./pane-layout-page";
import type { ActionSheetController } from "../../../shared/ui/overlay/action-sheet";
import { Button, Spinner } from "../../../shared/ui/primitives";
import { PanePage } from "./pane-page";

/**
 * Pages pushed inside the pane sheet share one skeleton: the sheet's header
 * names the page and the way back, the body holds the form, and a footer
 * pinned to the bottom says what will happen above the one primary button.
 * Running locks the form and spins the button; success closes the sheet;
 * failure stays on the page with the reason above the button.
 */

/** Why the primary action cannot run right now: offline, or another operation holds the lock. */
export function useOperationGate(): string {
  const { operationBusy } = useCapabilities();
  const { networkOnline } = useConnection();
  if (!networkOnline || !liveSession()?.isConnected()) return t("boardMenu.offline");
  return operationBusy ? t("boardMenu.busy") : "";
}

export type SheetRun = { pending: boolean; error: string; clearError: () => void; submit: (work: () => Promise<SheetOutcome>) => Promise<void> };

/** One submission at a time; the sheet closes on success. */
export function useSheetRun(modal: ActionSheetController): SheetRun {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  return {
    pending, error, clearError: () => setError(""),
    async submit(work) {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError("");
      try {
        const outcome = await work();
        if (outcome.ok) modal.dismiss();
        else setError(outcome.message);
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
  };
}

export function PageFooter({ summary, label, busyLabel, run, onSubmit, disabled = false, reason = "" }: {
  summary?: ReactNode; label: string; busyLabel: string; run: Pick<SheetRun, "pending" | "error">;
  onSubmit: () => void; disabled?: boolean; reason?: string;
}) {
  // While this page's own operation runs it holds the lock; the busy reason is ours, not news.
  const note = run.error || (run.pending ? "" : reason);
  return <div className="create-footer pane-page-footer">
    {summary ? <p className="create-summary">{summary}</p> : null}
    {note ? <p className={`pane-page-note${run.error ? " is-error" : ""}`} role={run.error ? "alert" : "status"}>{note}</p> : null}
    <Button className="btn btn-primary create-submit" disabled={disabled || run.pending || !!reason} aria-busy={run.pending} onClick={onSubmit}>
      {run.pending ? <><Spinner />{busyLabel}</> : label}
    </Button>
  </div>;
}

/** Enter in a single-line field submits the page; the sheet form itself never submits. */
function enterSubmits(submit: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
}

function workspaceName(agent: AgentCard): string {
  const path = agent.workspaceCwd || agent.cwd;
  return agent.workspaceLabel?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

/**
 * The kind choice both create pages share, with the home sheet's grid and its
 * full list swapped in place (not pushed), so the page keeps what was typed.
 */
function useKindChoice() {
  const [kinds] = useState(() => [...advertisedAgentKinds()]);
  const [memory, setMemory] = useState(loadCreateMemory);
  const [lastKind] = useState(() => loadLastAgentKind(kinds));
  const [kind, setKind] = useState(() => kinds.includes(lastKind) ? lastKind : kinds[0] ?? "");
  const [picking, setPicking] = useState(false);
  const grid = <>
    <AgentKindGrid kinds={kinds} memory={memory} selected={kind} lastKind={lastKind} onSelect={setKind} onShowAll={() => setPicking(true)} />
    {!kinds.length ? <p className="create-hint">{t("create.noKinds")}</p> : null}
  </>;
  const picker = picking ? <PanePage key="picker" tall>
    <AgentKindPickerPanel kinds={kinds} memory={memory} selected={kind} onBack={() => setPicking(false)}
      onPick={(next) => { setKind(next); setPicking(false); }} onPinsChange={setMemory} />
  </PanePage> : null;
  return { kind, grid, picker };
}

export function NewTabPage({ modal, agent }: { modal: ActionSheetController; agent: AgentCard }) {
  const { kind, grid, picker } = useKindChoice();
  const [label, setLabel] = useState("");
  const run = useSheetRun(modal);
  const reason = useOperationGate();
  const workspace = workspaceName(agent);
  const submit = () => {
    if (reason) return;
    const name = label.trim().slice(0, OPERATION_INPUT_LIMITS.label);
    void run.submit(async () => {
      const outcome = await createSelectedTab(agent, { ...(kind ? { agent_kind: kind } : {}), ...(name ? { label: name } : {}) });
      if (outcome.ok) rememberCreate({ kind, workspaceId: agent.workspaceId });
      return outcome;
    });
  };
  if (picker) return picker;
  return <PanePage key="form">
    <div className="create-sheet-body pane-create" onKeyDown={enterSubmits(submit)}>
      <fieldset className="pane-fieldset" disabled={run.pending}>
        <h3 className="create-label">{t("create.where")}</h3>
        <div className="pane-where">
          <Folder size={18} aria-hidden="true" />
          <span className="pane-where-text"><b>{workspace}</b><small>{t("pm.currentWorkspace")} · {agent.workspaceCwd || agent.cwd}</small></span>
        </div>
        <h3 className="create-label">{t("create.what")}</h3>
        {grid}
        <label className="create-field">
          <span>{t("create.tabName")} <span className="create-optional">{t("create.optional")}</span></span>
          <input className="create-input" type="text" value={label} maxLength={OPERATION_INPUT_LIMITS.label} autoComplete="off"
            placeholder={t("create.nameTabHint", { kind: kindName(kind) })} enterKeyHint="go"
            onChange={(event) => { setLabel(event.currentTarget.value); run.clearError(); }} />
        </label>
      </fieldset>
      <PageFooter summary={t("create.summaryTab", { workspace, kind: kindName(kind) })} label={t("create.submit")}
        busyLabel={t("pm.creating")} run={run} reason={reason} onSubmit={submit} />
    </div>
  </PanePage>;
}

export function SplitPage({ modal, agent }: { modal: ActionSheetController; agent: AgentCard }) {
  const { kind, grid, picker } = useKindChoice();
  const [direction, setDirection] = useState<SplitDirection>("right");
  const run = useSheetRun(modal);
  const reason = useOperationGate();
  const submit = () => {
    if (reason) return;
    void run.submit(async () => {
      const outcome = await splitSelectedPane(agent, { input: { direction, ratio: 0.5, ...(kind ? { agent_kind: kind } : {}) } });
      if (outcome.ok) rememberCreate({ kind });
      return outcome;
    });
  };
  if (picker) return picker;
  return <PanePage key="form">
    <div className="create-sheet-body pane-create">
      <fieldset className="pane-fieldset" disabled={run.pending}>
        <h3 className="create-label">{t("pm.splitWhere")} <span className="create-optional">{t("pm.splitWhereHint")}</span></h3>
        <SplitPreview agent={agent} direction={direction} onDirection={setDirection} />
        <h3 className="create-label">{t("create.what")}</h3>
        {grid}
      </fieldset>
      <PageFooter summary={t(direction === "right" ? "pm.splitSummaryRight" : "pm.splitSummaryDown", { kind: kindName(kind) })}
        label={t("pm.splitSubmit")} busyLabel={t("pm.creating")} run={run} reason={reason} onSubmit={submit} />
    </div>
  </PanePage>;
}

/**
 * The tab as it is, with this cell already cut in two the chosen way. The two
 * "+" handles sit on this cell's right and bottom edges and are the direction
 * choice itself (a radio pair).
 */
function SplitPreview({ agent, direction, onDirection }: {
  agent: AgentCard; direction: SplitDirection; onDirection: (direction: SplitDirection) => void;
}) {
  const layout = useTabLayout(agent);
  const { listGroup } = usePreferences();
  const boxes: CellBox[] = layout ? layoutBoxes(layout, agent.paneId) : [{ paneId: agent.paneId, x: 0, y: 0, width: 100, height: 100 }];
  const own = boxes.find(box => box.paneId === agent.paneId) ?? { paneId: agent.paneId, x: 0, y: 0, width: 100, height: 100 };
  const right = direction === "right";
  const half = right ? { ...own, width: own.width / 2 } : { ...own, height: own.height / 2 };
  const fresh = right ? { ...half, x: own.x + own.width / 2 } : { ...half, y: own.y + own.height / 2 };
  const agents = useDashboard().agents;
  const title = (paneId: string) => { const card = agents.find(item => item.paneId === paneId); return card ? agentTitle(card, listGroup) : ""; };
  return <div className="pane-layout-preview pane-split-preview" style={{ aspectRatio: String(layoutRatio(layout)) }}>
    {boxes.filter(box => box.paneId !== agent.paneId).map(box => <span key={box.paneId} className="pane-layout-cell" style={cellStyle(box)} aria-hidden="true">
      <span><b>{title(box.paneId)}</b></span>
    </span>)}
    <span className="pane-layout-cell is-current" style={cellStyle(half)} aria-hidden="true"><span><b>{t("pane.thisCell")}</b></span></span>
    <span className="pane-layout-cell is-new" style={cellStyle(fresh)} aria-hidden="true"><span><b>{t("pm.newCell")}</b></span></span>
    <div role="radiogroup" aria-label={t("pm.splitWhere")}>
      {(["right", "down"] as const).map(value => <Button key={value} className={`pane-split-plus${direction === value ? " on" : ""}`} role="radio"
        aria-checked={direction === value} aria-label={t(value === "right" ? "pm.splitRightAria" : "pm.splitDownAria")}
        style={value === "right" ? { left: `${own.x + own.width}%`, top: `${own.y + own.height / 2}%` }
          : { left: `${own.x + own.width / 2}%`, top: `${own.y + own.height}%` }}
        onClick={() => onDirection(value)}><Plus size={16} aria-hidden="true" /></Button>)}
    </div>
  </div>;
}

export function RenamePage({ modal, agent }: { modal: ActionSheetController; agent: AgentCard }) {
  const [value, setValue] = useState(agent.paneLabel || "");
  const { listGroup } = usePreferences();
  const input = useRef<HTMLInputElement>(null);
  const run = useSheetRun(modal);
  const reason = useOperationGate();
  const automatic = agentTitle({ ...agent, paneLabel: "" }, listGroup);
  const submit = () => { if (!reason) void run.submit(() => renamePaneTo(agent, value)); };
  return <PanePage>
    <div className="create-sheet-body pane-create" onKeyDown={enterSubmits(submit)}>
      <fieldset className="pane-fieldset" disabled={run.pending}>
        <div className="pane-rename">
          <input ref={input} className="create-input" type="text" value={value} maxLength={OPERATION_INPUT_LIMITS.label} autoComplete="off"
            aria-label={t("op.paneName")} placeholder={automatic} enterKeyHint="done" data-autofocus=""
            onChange={(event) => { setValue(event.currentTarget.value); run.clearError(); }} />
          {value ? <Button className="icon-btn pane-rename-clear" aria-label={t("pm.renameClear")}
            onClick={() => { setValue(""); input.current?.focus(); }}><X size={14} aria-hidden="true" /></Button> : null}
        </div>
        <p className="create-hint">{t("pm.renameHint", { name: automatic })}</p>
      </fieldset>
      <PageFooter label={t("pm.save")} busyLabel={t("pm.saving")} run={run} reason={reason} onSubmit={submit} />
    </div>
  </PanePage>;
}
