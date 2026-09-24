import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { t } from "../../../lib/i18n";
import { bindRowBubble, copyRow, placeRowBubble, quoteRow, rowBarContent } from "./rowbar";
import { paneModel } from "./pane-model";
import { sessionStore } from "../session-store";
import { selectTermRow } from "./term";
import { Button } from "../../../shared/ui/primitives";

function pickedRow(): number | null {
  return sessionStore.get().paneRow;
}

/**
 * Floating actions for the picked terminal row (`state.paneRow`).
 *
 * DOM: `.row-bubble[role=toolbar] > .row-act`, absolutely positioned in the
 * pane's `.term-stage` above (or below) `.term-line.is-picked`, so opening it
 * never shifts the buffer. Empty rows are discarded by `discardEmptyPaneRow`
 * in a controller, never during render. Returns null when there is no
 * copyable row.
 */
export function SessionRowBar() {
  // The picked row is a narrow slice: the bubble follows it without waiting for a pane commit.
  useSyncExternalStore(sessionStore.subscribe, pickedRow, pickedRow);
  const content = rowBarContent(paneModel());
  const bubble = useRef<HTMLDivElement>(null);
  const index = content?.index ?? null;
  useLayoutEffect(() => {
    if (index !== null && bubble.current) placeRowBubble(bubble.current, index);
  });
  useEffect(() => {
    if (index === null || !bubble.current) return;
    return bindRowBubble(bubble.current, index);
  }, [index]);
  if (!content) return null;
  const { text, path } = content;
  return (
    <div ref={bubble} className="row-bubble" role="toolbar" aria-label={t("rowbar.aria")} data-react-session-rowbar="">
      <Button className="row-act" aria-label={t("rowbar.copyAria")} onClick={() => void copyRow(text, t("row.copiedLine"))}>
        {t("rowbar.copy")}
      </Button>
      {path ? (
        <Button className="row-act" aria-label={t("rowbar.copyPathAria", { path })} title={path}
          onClick={() => void copyRow(path, t("row.copiedPath"))}>
          {t("rowbar.copyPath")}
        </Button>
      ) : null}
      <Button className="row-act" aria-label={t("rowbar.quoteAria")} onClick={() => quoteRow(text)}>
        {t("rowbar.quote")}
      </Button>
      <Button className="row-act" aria-label={t("rowbar.selectAria")} onClick={() => selectTermRow(content.index)}>
        {t("rowbar.select")}
      </Button>
    </div>
  );
}
