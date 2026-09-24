import { Lock, ScanLine } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { t } from "../../lib/i18n";
import { BackBar, Brand, Button, Spinner } from "../../shared/ui/primitives";
import { PairCodeSheet } from "./code-sheet";
import type { ConnectViewModel } from "./model";
import { TerminalMiniature } from "./terminal-miniature";

/**
 * Connect/pairing screen. Pure: copy and flags arrive in the view model,
 * mutations are callbacks, and the language control is a slot the page owns.
 *
 * Four fixed regions — top bar, terminal miniature, title + lede, bottom
 * actions — so idle, connecting, approval and failure change content in place
 * and never move the layout. Typing the code happens in `PairCodeSheet`.
 */
export function ConnectView({
  view, language, onBack, onCancel, onScan, onOpenCode, onCloseCode, onInstall, onPaste, onSubmit, onCodeChange,
}: {
  view: ConnectViewModel;
  language: ReactNode;
  onBack: () => void;
  onCancel: () => void;
  onScan: () => void;
  onOpenCode: () => void;
  onCloseCode: () => void;
  onInstall: () => void;
  onPaste: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCodeChange: (code: string) => void;
}) {
  return (
    <div className={`page connect-page is-${view.stage}`} aria-busy={view.busy}>
      {view.adding
        ? <BackBar title={view.backTitle} onBack={onBack} />
        : <div className="topbar connect-top"><Brand />{language}</div>}
      <TerminalMiniature stage={view.stage} />
      <div className="connect-copy">
        <h1 className="connect-title">{view.stage === "connecting" ? <Spinner className="connect-spinner" /> : null}{view.title}</h1>
        <p className={`connect-lede is-${view.ledeTone}`} aria-live="polite">
          <Lede view={view} />
          {view.showInstall ? <> <button type="button" className="connect-install" onClick={onInstall}>{t("connect.install")}</button></> : null}
        </p>
      </div>
      <div className="connect-actions">
        {view.busy
          ? <Button className="btn connect-cancel" onClick={onCancel}>{t("cancel")}</Button>
          : <>
            <Button className="btn btn-primary connect-scan" onClick={onScan}><ScanLine size={18} aria-hidden="true" />{t("connect.scan")}</Button>
            <Button className="btn btn-ghost connect-manual" onClick={onOpenCode}>{t("connect.manual")}</Button>
          </>}
        <p className="trust"><Lock size={11} aria-hidden="true" />{t("connect.trust")}</p>
      </div>
      {view.sheetOpen
        ? <PairCodeSheet view={view} onDismiss={onCloseCode} onPaste={onPaste} onSubmit={onSubmit} onCodeChange={onCodeChange} />
        : null}
    </div>
  );
}

/** The approval lede names the Enter key as a keycap. */
function Lede({ view }: { view: ConnectViewModel }) {
  if (!view.ledeKeycap) return <>{view.lede}</>;
  const [before, after = ""] = view.lede.split("{key}");
  return <>{before}<kbd className="connect-key">⏎ Enter</kbd>{after}</>;
}
