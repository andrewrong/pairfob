import { t } from "../../lib/i18n";
import { SetGroup } from "../../shared/ui/primitives";
import type { QuotaPanelModel } from "./model";
import { QuotaCardView, QuotaMissingItem } from "./quota-card-view";

/** The full quota page body. Pure: the caller decided which session's snapshot this is. */
export function QuotaPanelView({ panel }: { panel: QuotaPanelModel }) {
  const withData = panel.cards.filter(card => card.state !== "missing");
  const missing = panel.cards.filter(card => card.state === "missing");
  return (
    <section className="quota-panel" aria-busy={panel.busy}>
      <p className="quota-lede">{t("quota.note")}</p>
      {panel.error ? <p className="quota-lede is-error">{panel.error}</p> : null}
      {panel.offline ? <p className="quota-lede">{panel.offlineCopy}</p> : null}
      {withData.map(card => <QuotaCardView key={card.provider} card={card} />)}
      {missing.length ? <SetGroup className="quota-missing-group" label={`${t("quota.noDataGroup")} · ${missing.length}`}>
        {missing.map(card => <QuotaMissingItem key={card.provider} card={card} />)}
      </SetGroup> : null}
    </section>
  );
}
