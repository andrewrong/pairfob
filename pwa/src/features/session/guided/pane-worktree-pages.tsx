import { ChevronRight, GitBranch, Plus } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { t } from "../../../lib/i18n";
import { messageOf } from "../../../lib/notices";
import { OPERATION_INPUT_LIMITS, type WorktreeSummary } from "../../../lib/operations";
import type { DashboardAgentCard as AgentCard } from "../../../lib/dashboard";
import { createPaneWorktree, loadPaneWorktrees, openPaneWorktree, type SheetOutcome } from "../../operations/controller";
import { useCapabilities } from "../../operations/hooks";
import { useSheetNav } from "../../../shared/ui/overlay/sheet-stack";
import type { ActionSheetController } from "../../../shared/ui/overlay/action-sheet";
import { Button, SegmentedControl, SegmentedOption, Spinner } from "../../../shared/ui/primitives";
import { PageFooter, useOperationGate, useSheetRun } from "./pane-menu-pages";
import { PanePage } from "./pane-page";

/**
 * The branch of the Worktree this pane runs in, as last listed on this phone.
 * The snapshot carries no branch, so the menu row shows it once the list has
 * been read, and nothing (rather than a guess) before that.
 */
const knownBranch = new Map<string, string>();

export function worktreeBranch(agent: AgentCard): string {
  return knownBranch.get(agent.paneId) ?? "";
}

function worktreeTitle(item: WorktreeSummary): string {
  return item.branch || item.label || item.path.split(/[\\/]/).filter(Boolean).at(-1) || item.path;
}

function isCurrent(agent: AgentCard, item: WorktreeSummary): boolean {
  const checkout = agent.worktree?.checkout_path;
  return checkout ? item.path === checkout : !!agent.workspaceId && item.openWorkspaceId === agent.workspaceId;
}

type ListState = { items: WorktreeSummary[]; loading: boolean; error: string };

/**
 * The Worktree page is the list itself: it starts loading when pushed (three
 * skeleton rows meanwhile) and a tap opens the row in place, with the row's
 * own spinner; opening closes the sheet on the new session.
 */
export function WorktreePage({ modal, agent }: { modal: ActionSheetController; agent: AgentCard }) {
  const nav = useSheetNav()!;
  const caps = useCapabilities().operationCapabilities;
  const reason = useOperationGate();
  const [list, setList] = useState<ListState>({ items: [], loading: !!caps.list_worktrees, error: "" });
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");

  useEffect(() => {
    if (!caps.list_worktrees) return;
    let live = true;
    setList(state => ({ ...state, loading: true, error: "" }));
    loadPaneWorktrees(agent).then(items => {
      if (!live) return;
      const current = items.find(item => isCurrent(agent, item));
      if (current?.branch) knownBranch.set(agent.paneId, current.branch);
      setList({ items, loading: false, error: "" });
    }, error => { if (live) setList({ items: [], loading: false, error: messageOf(error) }); });
    return () => { live = false; };
  }, [agent, attempt, caps.list_worktrees]);

  const open = async (item: WorktreeSummary) => {
    if (opening || reason) return;
    setOpening(item.path);
    setOpenError("");
    let outcome: SheetOutcome;
    try { outcome = await openPaneWorktree(agent, { path: item.path, ...(item.label ? { label: item.label } : {}) }); }
    finally { setOpening(""); }
    if (outcome.ok) modal.dismiss();
    else setOpenError(outcome.message);
  };

  return <PanePage tall className="pane-worktrees">
    {caps.create_worktree && <div className="menu-group">
      <Button className="menu-row pane-row-accent" onClick={() => nav.push({ key: "wt-new", title: t("pm.wtNew"),
        render: () => <WorktreeCreatePage agent={agent} /> })}>
        <span className="menu-row-icon" aria-hidden="true"><Plus size={18} /></span>
        <span className="menu-row-label">{t("pm.wtNew")}</span>
        <ChevronRight className="menu-row-next" size={18} aria-hidden="true" />
      </Button>
    </div>}
    {caps.list_worktrees && <>
      <h3 className="pane-group-title" aria-live="polite">{list.loading ? t("pm.wtLoading")
        : list.error ? "" : list.items.length ? t("pm.wtCount", { n: String(list.items.length) }) : t("form.worktreesEmpty")}</h3>
      {list.error ? <div className="pane-page-note is-error" role="alert">{list.error}{" "}
        <Button className="text-link" onClick={() => setAttempt(value => value + 1)}>{t("pm.wtRetry")}</Button></div> : null}
      {openError || (!list.loading && reason) ? <p className={`pane-page-note${openError ? " is-error" : ""}`} role={openError ? "alert" : "status"}>
        {openError || reason}</p> : null}
      <ul className="pane-wt-list" aria-busy={list.loading || !!opening}>
        {list.loading ? [0, 1, 2].map(index => <li key={index} className="pane-wt is-skeleton" aria-hidden="true">
          <span className="pane-skel" /><span className="pane-skel is-short" /></li>)
          : list.items.map((item, index) => {
            const current = isCurrent(agent, item);
            const tag = current ? t("pm.wtCurrent") : item.openWorkspaceId ? t("form.worktreeOpened") : "";
            const body = <>
              <GitBranch className="pane-wt-icon" size={18} aria-hidden="true" />
              <span className="pane-wt-text"><b>{worktreeTitle(item)}</b><small>{item.path}</small></span>
              {opening === item.path ? <Spinner /> : tag ? <span className={`pane-wt-tag${current ? " is-current" : ""}`}>{tag}</span>
                : !current && caps.open_worktree ? <ChevronRight size={18} aria-hidden="true" className="menu-row-next" /> : null}
            </>;
            return <li key={`${item.path}:${index}`}>
              {current || !caps.open_worktree ? <div className="pane-wt">{body}</div>
                : <Button className="pane-wt" disabled={!!opening || !!reason} aria-label={t("form.openWorktreeNamed", { title: worktreeTitle(item) })}
                  onClick={() => void open(item)}>{body}</Button>}
            </li>;
          })}
      </ul>
    </>}
    {caps.open_worktree && <div className="menu-group">
      <Button className="menu-row" onClick={() => nav.push({ key: "wt-open", title: t("menu.openWorktree"),
        render: () => <WorktreeOpenPage modal={modal} agent={agent} /> })}>
        <span className="menu-row-label">{t("pm.wtOpenBy")}</span>
        <ChevronRight className="menu-row-next" size={18} aria-hidden="true" />
      </Button>
    </div>}
  </PanePage>;
}

function enterSubmits(submit: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
}

const MONO = { className: "create-input is-mono", type: "text", autoComplete: "off", autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;

/**
 * Create runs as the existing background job card, so the page does not wait
 * for it: the button says it is under way and the sheet can be closed.
 */
function WorktreeCreatePage({ agent }: { agent: AgentCard }) {
  const [fields, setFields] = useState({ branch: "", base: "", label: "", path: "" });
  const [state, setState] = useState<{ started: boolean; error: string }>({ started: false, error: "" });
  const reason = useOperationGate();
  const set = (key: keyof typeof fields) => (event: { currentTarget: HTMLInputElement }) => {
    const value = event.currentTarget.value;
    setFields(current => ({ ...current, [key]: value }));
    setState(current => ({ ...current, error: "" }));
  };
  const submit = () => {
    if (state.started || reason) return;
    if (createPaneWorktree(agent, fields)) setState({ started: true, error: "" });
    else setState({ started: false, error: t("op.worktreeJobLimit") });
  };
  const dir = agent.workspaceCwd || agent.cwd;
  return <PanePage>
    <div className="create-sheet-body pane-create" onKeyDown={enterSubmits(submit)}>
      <fieldset className="pane-fieldset" disabled={state.started}>
        <label className="create-field">{t("create.branch")}
          <input {...MONO} value={fields.branch} placeholder={t("create.branchHint")} maxLength={OPERATION_INPUT_LIMITS.branch} onChange={set("branch")} />
        </label>
        <label className="create-field">{t("create.base")}
          <input {...MONO} value={fields.base} placeholder={t("create.baseHint")} maxLength={OPERATION_INPUT_LIMITS.base} onChange={set("base")} />
        </label>
        <label className="create-field">
          <span>{t("pm.wtName")} <span className="create-optional">{t("create.optional")}</span></span>
          <input className="create-input" type="text" autoComplete="off" value={fields.label} placeholder={t("pm.wtNameHint")}
            maxLength={OPERATION_INPUT_LIMITS.label} onChange={set("label")} />
        </label>
        <details className="pane-precise">
          <summary>{t("pm.wtAdvanced")}</summary>
          <input {...MONO} value={fields.path} placeholder={t("create.pathPlaceholder")} aria-label={t("pm.wtAdvanced")}
            maxLength={OPERATION_INPUT_LIMITS.path} onChange={set("path")} />
        </details>
        <p className="create-hint">{t("pm.wtCreateHint")}</p>
      </fieldset>
      <PageFooter summary={dir ? t("pm.wtCreateSummary", { dir }) : undefined} label={t(state.started ? "pm.wtCreateStarted" : "pm.wtCreate")}
        busyLabel={t("pm.creating")} run={{ pending: false, error: state.error }} disabled={state.started} reason={state.started ? "" : reason}
        onSubmit={submit} />
    </div>
  </PanePage>;
}

/** One target, named one way: a branch or a path, never both. */
function WorktreeOpenPage({ modal, agent }: { modal: ActionSheetController; agent: AgentCard }) {
  const [by, setBy] = useState<"branch" | "path">("branch");
  const [value, setValue] = useState("");
  const run = useSheetRun(modal);
  const reason = useOperationGate();
  const submit = () => {
    if (reason) return;
    void run.submit(() => openPaneWorktree(agent, by === "path" ? { path: value } : { branch: value }));
  };
  return <PanePage>
    <div className="create-sheet-body pane-create" onKeyDown={enterSubmits(submit)}>
      <fieldset className="pane-fieldset" disabled={run.pending}>
        <SegmentedControl className="create-seg" aria-label={t("menu.openWorktree")}>
          {(["branch", "path"] as const).map(option => <SegmentedOption key={option} selected={by === option}
            onClick={() => { setBy(option); run.clearError(); }}>{t(option === "branch" ? "pm.wtByBranch" : "pm.wtByPath")}</SegmentedOption>)}
        </SegmentedControl>
        <input {...MONO} value={value} aria-label={t(by === "branch" ? "pm.wtByBranch" : "pm.wtByPath")} data-autofocus=""
          placeholder={by === "branch" ? t("pm.wtBranchPlaceholder") : t("create.pathPlaceholder")}
          maxLength={by === "branch" ? OPERATION_INPUT_LIMITS.branch : OPERATION_INPUT_LIMITS.path}
          onChange={(event) => { setValue(event.currentTarget.value); run.clearError(); }} />
        <p className="create-hint">{t("pm.wtOpenHint")}</p>
      </fieldset>
      <PageFooter label={t("pm.wtOpen")} busyLabel={t("pm.opening")} run={run} reason={reason} onSubmit={submit} />
    </div>
  </PanePage>;
}
