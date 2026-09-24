import { t } from "../../lib/i18n";
import { SetGroup, SetItem, SetNavItem } from "../../shared/ui/primitives";
import type { QuotaModuleModel, QuotaProvider } from "./model";
import { QuotaMeter } from "./quota-meter";

/**
 * The settings quota module: one row per provider with its tightest window,
 * when it resets and how much is left, then a row into the full page. Offline
 * and failed reads are one line, never a strip of empty meters.
 */
export function QuotaModuleView({ model, onOpen }: { model: QuotaModuleModel; onOpen: (provider?: QuotaProvider) => void }) {
  const all = <SetNavItem className="quota-all" label={t("quota.allRow")}
    value={model.noData ? t("quota.noDataCount", { n: model.noData }) : undefined} onClick={() => onOpen()} />;
  return <SetGroup className="quota-module" label={t("quota.title")} aside={model.updated}>
    {model.state === "offline" ? <SetItem className="is-quiet" label={t("quota.offline")} />
      : model.state === "error" ? <><SetItem className="is-quiet" label={t("quota.failed")} />{all}</>
      : model.state === "loading" ? [0, 1, 2].map(index => <SetItem key={index} className="is-skeleton" label={<span className="skel" />}
          sub={<span className="skel skel-short" />} trailing={<span className="quota-meter is-empty"><span className="quota-bar" /></span>} />)
      : <>
          {model.rows.map(row => <SetNavItem key={row.provider} className="quota-row" chevron={false} label={row.name} sub={row.sub}
            value={<QuotaMeter meter={row.meter} />} onClick={() => onOpen(row.provider)} />)}
          {all}
        </>}
  </SetGroup>;
}
