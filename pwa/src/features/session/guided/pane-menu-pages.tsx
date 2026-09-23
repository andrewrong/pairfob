import { FolderOpen, List, Plus } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "../../../lib/i18n";
import type { SplitDirection } from "../../../lib/operations";
import type { DashboardAgentCard as AgentCard } from "../../../lib/dashboard";
import type { FormResult } from "../../operations/operation-form-model";
import { CreateTabFields, SplitPaneFields, readCreateTab, readSplitPane } from "../../operations/operation-forms";
import { createSelectedTab, createSelectedWorktree, listSelectedWorktrees, openSelectedWorktree, splitSelectedPane } from "../../operations/controller";
import type { OperationCapabilities } from "../../../lib/operations";
import { MenuGroup, MenuRow } from "../../../shared/ui/overlay/menu-controls";
import type { ActionSheetController, SheetAction } from "../../../shared/ui/overlay/action-sheet";

/**
 * Forms pushed inside the pane sheet. They reuse the operation dialogs' fields
 * and validation; submitting closes the sheet and hands the collected input to
 * the same controller path the standalone dialog uses.
 */
function SheetForm<T>({ modal, submitLabel, read, run, children }: {
  modal: ActionSheetController; submitLabel: string; children: ReactNode;
  read: (data: FormData) => FormResult<T>; run: (value: T) => SheetAction;
}) {
  const [error, setError] = useState("");
  const submit = () => {
    const form = modal.form.current;
    if (!form) return;
    const result = read(new FormData(form));
    if (result.ok) { modal.close(run(result.value)); return; }
    setError(result.message);
    if (result.field) form.querySelector<HTMLElement>(`[name="${result.field}"]`)?.focus();
  };
  // The sheet form never submits natively; Enter in a field submits this page.
  const enter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
  return <div className="operation-body sheet-form" onKeyDown={enter} onInput={() => setError("")}>
    {children}
    <p className="notice notice-error" role="alert" hidden={!error}>{error}</p>
    <button type="button" className="btn btn-primary sheet-form-submit" onClick={submit}>{submitLabel}</button>
  </div>;
}

export function SplitPage({ modal, agent, agentKinds }: { modal: ActionSheetController; agent: AgentCard; agentKinds: string[] }) {
  const [direction, setDirection] = useState<SplitDirection>("right");
  return <SheetForm modal={modal} submitLabel={t(direction === "right" ? "form.splitRight" : "form.splitDown")}
    read={data => readSplitPane(data, agentKinds)} run={input => () => splitSelectedPane(agent, { input })}>
    <SplitPaneFields agentKinds={agentKinds} defaultCwd={agent.cwd} hint={t("form.splitHint")} direction={
      <fieldset className="split-picker">
        <legend>{t("split.direction")}</legend>
        {(["right", "down"] as const).map(value => <label key={value} className={`split-choice${direction === value ? " is-on" : ""}`}>
          <input type="radio" name="direction" value={value} checked={direction === value} onChange={() => setDirection(value)} />
          <span className={`split-viz is-${value}`} aria-hidden="true"><i /><i /></span>
          <span>{t(value === "right" ? "split.right" : "split.down")}</span>
        </label>)}
      </fieldset>} />
  </SheetForm>;
}

export function NewTabPage({ modal, agent, agentKinds }: { modal: ActionSheetController; agent: AgentCard; agentKinds: string[] }) {
  return <SheetForm modal={modal} submitLabel={t("form.create")}
    read={data => readCreateTab(data, agentKinds)} run={input => () => createSelectedTab(agent, input)}>
    <CreateTabFields agentKinds={agentKinds} defaultCwd={agent.cwd} />
  </SheetForm>;
}

export function WorktreePage({ modal, caps }: { modal: ActionSheetController; caps: OperationCapabilities }) {
  return <MenuGroup>
    {caps.list_worktrees && <MenuRow icon={<List size={18} />} label={t("menu.worktrees")} modal={modal} action={listSelectedWorktrees} />}
    {caps.create_worktree && <MenuRow icon={<Plus size={18} />} label={t("menu.newWorktree")} modal={modal} action={createSelectedWorktree} />}
    {caps.open_worktree && <MenuRow icon={<FolderOpen size={18} />} label={t("menu.openWorktree")} modal={modal} action={openSelectedWorktree} />}
  </MenuGroup>;
}
