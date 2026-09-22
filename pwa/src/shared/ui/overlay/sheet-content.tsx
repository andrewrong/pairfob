import type { ReactNode, Ref } from "react";
import { t } from "../../../lib/i18n";
import { Button } from "../primitives/button";

export function SheetHandle() {
  return <div className="sheet-grab" aria-hidden="true"><span className="sheet-grab-bar" /></div>;
}

/** The common sheet header, close target and scrollable body, without another wrapper. */
export function SheetContent({ title, titleId, onDismiss, bodyRef, children }: {
  title: string; titleId: string; onDismiss: () => void; bodyRef: Ref<HTMLDivElement>; children: ReactNode;
}) {
  return <>
    <SheetHandle />
    <div className="sheet-head"><h2 id={titleId} className="modal-title">{title}</h2>
      <Button className="icon-btn sheet-close" aria-label={t("close")} onClick={onDismiss}>×</Button>
    </div>
    <div ref={bodyRef} className="sheet-body">{children}</div>
  </>;
}
