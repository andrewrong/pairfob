import { useRef, type KeyboardEvent } from "react";
import { t } from "../../../lib/i18n";
import type { AttentionCounts, AttentionFilter } from "../attention-filter";

const filters: AttentionFilter[] = ["all", "needs-you", "finished", "running", "checking"];

export function AttentionFilterControl({ selected, counts, onSelect }: {
  selected: AttentionFilter;
  counts: AttentionCounts;
  onSelect: (filter: AttentionFilter) => void;
}) {
  const controls = useRef<Array<HTMLButtonElement | null>>([]);
  const selectAt = (index: number) => {
    const filter = filters[index];
    if (!filter) return;
    onSelect(filter);
    controls.current[index]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % filters.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + filters.length) % filters.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = filters.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectAt(next);
  };
  return <div className="attention-filters" role="radiogroup" aria-label={t("filter.aria")}>
    {filters.map((filter, index) => <button key={filter} type="button" role="radio"
      ref={(node) => { controls.current[index] = node; }}
      tabIndex={selected === filter ? 0 : -1} aria-checked={selected === filter}
      className="attention-filter" onKeyDown={(event) => onKeyDown(event, index)}
      onClick={() => onSelect(filter)}>
      <span>{t(`filter.${filter}`)}</span><span className="attention-filter-count">{counts[filter]}</span>
    </button>)}
  </div>;
}
