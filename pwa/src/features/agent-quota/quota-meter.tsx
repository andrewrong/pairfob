import type { QuotaMeterModel } from "./model";

/** Remaining share as a bar plus a number, tinted when low. Pure: the model resolved tone and label. */
export function QuotaMeter({ meter }: { meter: QuotaMeterModel }) {
  if (meter.kind === "unlimited") {
    return <span className="quota-meter is-unlimited" role="img" aria-label={meter.aria}>
      <span className="quota-bar" aria-hidden="true"><i /></span><span className="quota-pct" aria-hidden="true">∞</span>
    </span>;
  }
  return <span className={`quota-meter is-${meter.tone}`} role="meter" aria-label={meter.aria}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.remaining}>
    <span className="quota-bar" aria-hidden="true"><i style={{ width: `${meter.remaining}%` }} /></span>
    <span className="quota-pct" aria-hidden="true">{meter.remaining}%</span>
  </span>;
}
