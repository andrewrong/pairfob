import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { t } from "../../../lib/i18n";
import { MenuItem, showActionSheet, type ActionSheetController } from "../../../shared/ui/overlay";
import { SegmentedControl, SegmentedOption } from "../../../shared/ui/primitives";
import type { AgentCard } from "../../../lib/ranking";
import type { ObjectMenuKind, ObjectMenuModel, ObjectMenuScope } from "../model/object-menu";

/**
 * What one menu action does. The sheet owns ordering, labels and gates from the
 * model; the runner owns the operation, so presentation never reaches the record
 * or the session.
 */
export type ObjectMenuRunner = (kind: ObjectMenuKind, agent: AgentCard) => void | Promise<void>;

const SCOPES: Array<{ id: ObjectMenuScope; label: "menu.scopePane" | "menu.scopeTab" | "menu.scopeWorkspace" }> = [
  { id: "pane", label: "menu.scopePane" },
  { id: "tab", label: "menu.scopeTab" },
  { id: "workspace", label: "menu.scopeWorkspace" },
];

/**
 * One object at a time. The path names where this session lives; the switch
 * picks the session, its tab or its workspace, so "close" on one of them can
 * never sit next to "close" on another.
 */
function ScopedMenu({ modal, model, agent, run }: {
  modal: ActionSheetController; model: ObjectMenuModel; agent: AgentCard; run: ObjectMenuRunner;
}) {
  const scopes = SCOPES.filter((scope) => model.items.some((item) => item.scope === scope.id));
  const [scope, setScope] = useState<ObjectMenuScope>(scopes[0]?.id ?? "pane");
  const panels = scopes.length > 1 ? scopes.map((option) => option.id) : [scope];
  const itemsOf = (id: ObjectMenuScope) => scopes.length > 1 ? model.items.filter((item) => item.scope === id) : model.items;
  return (
    <>
      {model.path.length > 1 && (
        <p className="sheet-path">
          {model.path.map((part, index) => (
            <Fragment key={index}>
              {index ? <ChevronRight size={12} aria-hidden="true" /> : null}
              <span className={index === model.path.length - 1 ? "sheet-path-here" : undefined}>{part}</span>
            </Fragment>
          ))}
        </p>
      )}
      {scopes.length > 1 && (
        <SegmentedControl className="menu-mode sheet-scope" aria-label={t("menu.scopeAria")}>
          {scopes.map((option) => (
            <SegmentedOption key={option.id} selected={scope === option.id} onClick={() => setScope(option.id)}>
              {t(option.label)}
            </SegmentedOption>
          ))}
        </SegmentedControl>
      )}
      {/* Every object's panel stays mounted; only the chosen one is shown. */}
      {panels.map((id) => {
        const items = itemsOf(id);
        return (
          <div key={id} className="sheet-scope-panel" data-scope={id} hidden={id !== scope}>
            {id === "pane" && model.facts.length > 0 && (
              <dl className="sheet-facts">
                {model.facts.map((row, index) => (
                  <div key={index} className="sheet-fact">
                    <dt className="sheet-fact-key">{row.key}</dt>
                    <dd className={`sheet-fact-val${row.kind === "path" ? " sheet-fact-path" : ""}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="menu-group">
              {items.filter((item) => !item.danger).map((item) => (
                <MenuItem key={item.kind} modal={modal} action={() => run(item.kind, agent)}>{item.label}</MenuItem>
              ))}
            </div>
            {items.some((item) => item.danger) && (
              <div className="menu-group menu-group-danger">
                {items.filter((item) => item.danger).map((item) => (
                  <MenuItem key={item.kind} modal={modal} danger action={() => run(item.kind, agent)}>{item.label}</MenuItem>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Present a projected object menu and route each item back through the runner. */
export function openObjectMenu(
  model: ObjectMenuModel,
  agent: AgentCard,
  run: ObjectMenuRunner,
): void {
  showActionSheet(model.title, (modal) => <ScopedMenu modal={modal} model={model} agent={agent} run={run} />);
}
