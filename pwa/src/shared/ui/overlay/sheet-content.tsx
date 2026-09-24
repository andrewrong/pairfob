import { ChevronLeft, X } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { t } from "../../../lib/i18n";
import { Button } from "../primitives/button";

export function SheetHandle() {
  return <div className="sheet-grab" aria-hidden="true"><span className="sheet-grab-bar" /></div>;
}

/** An expandable sheet's handle is also a tap target for the taller height. */
function ExpandHandle({ expanded, toggle }: { expanded: boolean; toggle: () => void }) {
  return <Button className="sheet-grab" aria-expanded={expanded} aria-label={t(expanded ? "sheet.collapse" : "sheet.expand")}
    onClick={toggle}><span className="sheet-grab-bar" aria-hidden="true" /></Button>;
}

/** The common sheet header, close target and scrollable body, without another wrapper. */
export function SheetContent({ title, titleId, subtitle, onDismiss, onBack, backLabel, expand, bodyRef, children }: {
  title: string; titleId: string; subtitle?: string; onDismiss: () => void; bodyRef: Ref<HTMLDivElement>; children: ReactNode;
  /** Present while a pushed page is showing. */
  onBack?: () => void;
  /** The page Back returns to, named next to the chevron. */
  backLabel?: string;
  expand?: { expanded: boolean; toggle: () => void };
}) {
  return <>
    {expand ? <ExpandHandle {...expand} /> : <SheetHandle />}
    <div className={`sheet-head${onBack ? " has-back" : ""}`}>
      {onBack && <Button className={`icon-btn sheet-back${backLabel ? " has-label" : ""}`} aria-label={t("sheet.back")} onClick={onBack}>
        <ChevronLeft size={22} aria-hidden="true" />{backLabel && <span className="sheet-back-label" aria-hidden="true">{backLabel}</span>}</Button>}
      {subtitle ? <div className="sheet-titles"><h2 id={titleId} className="modal-title">{title}</h2>
        <p className="sheet-subtitle">{subtitle}</p></div>
        : <h2 id={titleId} className="modal-title">{title}</h2>}
      <Button className="icon-btn sheet-close" aria-label={t("close")} onClick={onDismiss}><X size={20} aria-hidden="true" /></Button>
    </div>
    <div ref={bodyRef} className="sheet-body">{children}</div>
  </>;
}
