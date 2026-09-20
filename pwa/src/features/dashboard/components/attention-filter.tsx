import { t } from "../../../lib/i18n";
import type { AttentionCounts, AttentionFilter } from "../attention-filter";

const filters: AttentionFilter[] = ["all", "needs-you", "finished", "running", "checking"];

export function AttentionFilterControl({ selected, counts, onSelect }: {
  selected: AttentionFilter;
  counts: AttentionCounts;
  onSelect: (filter: AttentionFilter) => void;
}) {
  return <div className="attention-filters" role="radiogroup" aria-label={t("filter.aria")}>
    {filters.map((filter) => <button key={filter} type="button" role="radio"
      aria-checked={selected === filter} className="attention-filter"
      onClick={() => onSelect(filter)}>
      <span>{t(`filter.${filter}`)}</span><span className="attention-filter-count">{counts[filter]}</span>
    </button>)}
  </div>;
}
