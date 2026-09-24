import { t } from "../../lib/i18n";
import { CommandLine, SetGroup, SetItem, SetTag } from "../../shared/ui/primitives";
import type { QuotaCardModel } from "./model";
import { QuotaMeter } from "./quota-meter";

const copyLabels = () => ({ copy: t("set.copy"), copied: t("set.copied"), failed: t("set.copyFailed") });

/**
 * One provider with data: a head row (name, plan, when it was read), then one
 * row per window with the same meter the settings module uses. Pure: the model
 * resolved every string and the stale adjustment.
 */
export function QuotaCardView({ card }: { card: QuotaCardModel }) {
  return <SetGroup className="quota-card" id={`quota-${card.provider}`}>
    <SetItem className="quota-head" label={<>{card.title}<SetTag>{card.plan}</SetTag></>} sub={card.updated}
      trailing={card.state === "stale" ? <SetTag tone="warn">{t("quota.staleTag")}</SetTag> : null} />
    {card.state === "stale" ? <p className="set-item-note">{t("quota.staleRow")}</p>
      : card.windows.map(window => <SetItem key={window.key} label={window.label} sub={window.sub} trailing={<QuotaMeter meter={window.meter} />} />)}
    {card.notes.length ? <p className="set-item-note">{card.notes.join(" ")}</p> : null}
  </SetGroup>;
}

/** A provider without data: why, and the one step that fixes it. */
export function QuotaMissingItem({ card }: { card: QuotaCardModel }) {
  return <div className="set-item set-item-block quota-missing" id={`quota-${card.provider}`}>
    <span className="set-item-label">{card.title}</span>
    <span className="set-item-sub">{card.statusCopy}</span>
    {card.help ? <span className="set-item-sub">{card.help}</span> : null}
    {card.helpDetail ? <span className="set-item-sub">{card.helpDetail}</span> : null}
    {card.helpCommand ? <CommandLine command={card.helpCommand} labels={copyLabels()} /> : null}
    {card.command ? <CommandLine command={card.command} labels={copyLabels()} /> : null}
    {card.notes.length ? <span className="set-item-sub">{card.notes.join(" ")}</span> : null}
  </div>;
}
