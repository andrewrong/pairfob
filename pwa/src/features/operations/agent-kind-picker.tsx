import { Check, ChevronLeft, Star } from "lucide-react";
import { useState } from "react";
import { t } from "../../lib/i18n";
import { AgentAvatar, Button } from "../../shared/ui/primitives";
import { togglePinnedKind, type CreateMemory } from "./create-memory";

const FILTER_FROM = 9;

function ago(stamp: number | undefined, now: number): string {
  if (!stamp) return "";
  const days = Math.floor((now - stamp) / 86_400_000);
  if (days < 1) return t("list.agoNow");
  return t("list.agoDay", { n: String(days) });
}

/**
 * Every kind the computer advertises, pinned first, then by use. A ★ pins a
 * kind into the create grid; picking one selects it and returns to the form.
 * A filter appears only when the list is long.
 */
export function AgentKindPicker({ kinds, memory, selected, onPick, onPinsChange }: {
  kinds: readonly string[];
  memory: CreateMemory;
  selected: string;
  onPick: (kind: string) => void;
  onPinsChange: (memory: CreateMemory) => void;
}) {
  const [pins, setPins] = useState(memory.pinned);
  const [filter, setFilter] = useState("");
  const now = Date.now();
  const needle = filter.trim().toLowerCase();
  const shown = kinds.filter((kind) => !needle || kind.toLowerCase().includes(needle));
  const pinned = shown.filter((kind) => pins.includes(kind));
  const others = shown.filter((kind) => !pins.includes(kind))
    .sort((left, right) => (memory.uses[right] ?? 0) - (memory.uses[left] ?? 0) || left.localeCompare(right));
  const row = (kind: string) => {
    const on = pins.includes(kind);
    const uses = memory.uses[kind] ?? 0;
    return (
      <div key={kind} className={`kind-row${kind === selected ? " is-selected" : ""}`}>
        <Button className="kind-pick" aria-current={kind === selected ? "true" : undefined} onClick={() => onPick(kind)}>
          <AgentAvatar kind={kind} />
          <span className="kind-pick-text">
            <span className="kind-pick-name">{kind}</span>
            <span className="kind-pick-meta">
              {uses ? `${ago(memory.lastUsed[kind], now)} · ${t("create.usedTimes", { n: String(uses) })}` : t("create.neverUsed")}
            </span>
          </span>
          {kind === selected ? <Check className="menu-choice-check" size={18} aria-hidden="true" /> : null}
        </Button>
        <Button className={`icon-btn kind-star${on ? " is-on" : ""}`} aria-pressed={on}
          aria-label={t(on ? "create.unpinAria" : "create.pinAria", { kind })}
          onClick={() => {
            const next = togglePinnedKind(kind);
            setPins(next.pinned);
            onPinsChange(next);
          }}>
          <Star size={20} aria-hidden="true" fill={on ? "currentColor" : "none"} />
        </Button>
      </div>
    );
  };
  return (
    <div className="kind-picker">
      {kinds.length >= FILTER_FROM ? (
        <input className="kind-filter" type="text" value={filter} placeholder={t("create.pickerFilter")}
          aria-label={t("create.pickerFilter")} autoComplete="off" autoCapitalize="off" spellCheck={false}
          onChange={(event) => setFilter(event.currentTarget.value)} />
      ) : null}
      <h3 className="create-label">{t("create.pinnedGroup")}</h3>
      {pinned.length ? pinned.map(row) : <p className="kind-empty">{t("create.pinnedGroupEmpty")}</p>}
      {others.length ? <h3 className="create-label">{t("create.otherGroup")}</h3> : null}
      {others.map(row)}
      <p className="kind-note">{t("create.pickerNote")}</p>
    </div>
  );
}

/**
 * The full list in place of a create form, with its own way back. The form
 * stays mounted in its owner's state, so everything already chosen is kept.
 */
export function AgentKindPickerPanel({ onBack, ...picker }: Parameters<typeof AgentKindPicker>[0] & { onBack: () => void }) {
  return (
    <div className="create-sheet-body is-picking">
      <div className="create-picker-head">
        <Button className="icon-btn" aria-label={t("sheet.back")} onClick={onBack}>
          <ChevronLeft size={22} aria-hidden="true" />
        </Button>
        <h3 className="create-picker-title">{t("create.pickerTitle")}</h3>
      </div>
      <AgentKindPicker {...picker} />
    </div>
  );
}
