import { Check } from "lucide-react";
import { t } from "../../../lib/i18n";
import type { ListGroup } from "../../../lib/ranking";
import { MenuItem, showActionSheet } from "../../../shared/ui/overlay";
import { listGroup } from "../../settings/preferences-store";
import { chooseListGroup } from "./herd-controls";

const OPTIONS: Array<{ id: ListGroup; label: "list.flat" | "list.space" | "list.agent" }> = [
  { id: "flat", label: "list.flat" },
  { id: "space", label: "list.space" },
  { id: "agent", label: "list.agent" },
];

/**
 * The list grouping, chosen from the list itself. The same preference the
 * settings screen edits; picking one closes the sheet and regroups in place.
 */
export function openGroupingSheet(): void {
  const current = listGroup();
  showActionSheet(t("list.groupAria"), (modal) => <div className="grouping-sheet" role="radiogroup" aria-label={t("list.groupAria")}>
    {OPTIONS.map((option) => <MenuItem key={option.id} modal={modal} action={() => chooseListGroup(option.id)}>
      <span className="grouping-option" role="radio" aria-checked={current === option.id}>
        <span className="grouping-label">{t(option.label)}</span>
        {current === option.id ? <Check size={18} aria-hidden="true" /> : null}
      </span>
    </MenuItem>)}
    <p className="empty-sub">{t("settings.listNote")}</p>
  </div>);
}
