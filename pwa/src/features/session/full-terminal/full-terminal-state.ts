import { t, type LocalizedText } from "../../../lib/i18n";

export type FullTerminalStage = "loading" | "opening" | "waiting" | "error" | "live";

export class FullTerminalStatus {
  detail: LocalizedText = "";
  stage: FullTerminalStage = "loading";
  private retryAvailable = false;

  constructor(private readonly repaint: () => void) {}

  get retry(): boolean {
    return this.retryAvailable;
  }

  set(detail: LocalizedText, stage: FullTerminalStage = this.stage): void {
    if (JSON.stringify(this.detail) === JSON.stringify(detail) && this.stage === stage) return;
    this.detail = detail;
    this.stage = stage;
    this.repaint();
  }

  fail(detail: LocalizedText): void {
    this.retryAvailable = true;
    this.set(detail, "error");
  }

  wait(detail: LocalizedText): void {
    this.retryAvailable = false;
    this.set(detail, "waiting");
  }

  start(detail: LocalizedText, stage: "opening" | "live"): void {
    this.retryAvailable = false;
    this.set(detail, stage);
  }

  reset(detail: LocalizedText): void {
    this.retryAvailable = false;
    this.set(detail, "loading");
  }

  clearRetry(): void {
    this.retryAvailable = false;
  }
}

const FULL_TERMINAL_DOCUMENT_CLASS = "full-terminal-active";

export function setFullTerminalDocumentMode(active: boolean): void {
  document.documentElement.classList.toggle(FULL_TERMINAL_DOCUMENT_CLASS, active);
}

export function fullTerminalStateTitle(stage: FullTerminalStage): string {
  switch (stage) {
    case "loading":
      return t("ft.stateLoading");
    case "opening":
      return t("ft.stateOpening");
    case "waiting":
      return t("ft.stateWaiting");
    case "error":
      return t("ft.stateError");
    case "live":
      return "";
  }
}
