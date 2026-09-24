import { t } from "../../lib/i18n";
import { normalizeCrockford } from "../../lib/protocol/bytes";
import type { PairStepKey } from "../../lib/ui-model";
import type { FragmentPairing } from "../../lib/pairing-input";

export type ConnectNotice = { text: string; tone: "error" | "status" };

/**
 * Pure projection for the connect/pairing screen. The caller supplies the
 * handshake input, connection phase and notice; this file does not read state.
 *
 * One skeleton for every stage: top bar, terminal miniature, title + lede and
 * the bottom actions. A stage only swaps copy and the miniature's lines.
 */

export type ConnectStage = "idle" | "connecting" | "approve" | "failed";

export type ConnectViewInput = {
  phase: string;
  addingComputer: boolean;
  computerCount: number;
  fragment: FragmentPairing | null;
  pairCodeDraft: string;
  pairManualOpen: boolean;
  pairErrorTarget: "code" | null;
  pairFailedStep: PairStepKey | null;
  pairAwaitingApproval: boolean;
  notice: ConnectNotice | null;
  desk: boolean;
};

export type ConnectViewModel = {
  adding: boolean;
  busy: boolean;
  stage: ConnectStage;
  backTitle: string;
  title: string;
  lede: string;
  ledeTone: "muted" | "error" | "status";
  /** The lede carries a `{key}` slot for the Enter keycap. */
  ledeKeycap: boolean;
  showInstall: boolean;
  sheetOpen: boolean;
  /** The notice shown inside the code sheet instead of on the page. */
  sheetNotice: ConnectNotice | null;
  pairCodeDraft: string;
  pairCodeLength: number;
  pairCodeComplete: boolean;
  pairCodeInvalid: boolean;
};

/**
 * Group a typed code as the computer prints it (4-4-6) while the reader types at
 * the end of the field. Anything that is not plain code characters (a pasted
 * link) is left for the submit parser.
 */
export function formatPairCodeDraft(raw: string): string {
  if (!/^[0-9A-Za-z \-]*$/.test(raw)) return raw;
  const code = normalizeCrockford(raw).slice(0, 14);
  if (code.length > 8) return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  if (code.length > 4) return `${code.slice(0, 4)}-${code.slice(4)}`;
  return code;
}

function stageOf(input: ConnectViewInput): ConnectStage {
  if (input.phase === "pairing") return input.pairAwaitingApproval ? "approve" : "connecting";
  return input.pairFailedStep && input.pairFailedStep !== "code" ? "failed" : "idle";
}

export function connectViewModel(input: ConnectViewInput): ConnectViewModel {
  const stage = stageOf(input);
  const busy = stage === "connecting" || stage === "approve";
  const adding = input.addingComputer || input.computerCount > 0;
  const sheetOpen = !busy && input.pairManualOpen;
  const length = normalizeCrockford(input.pairCodeDraft).length;
  // A code error belongs to the field; the page never repeats it.
  const pageNotice = sheetOpen || input.pairErrorTarget === "code" ? null : input.notice;
  let title = t("connect.title");
  let lede = input.desk && !adding && !input.fragment ? t("connect.ledeDesk") : t("connect.ledeIdle");
  let ledeTone: ConnectViewModel["ledeTone"] = "muted";
  let showInstall = true;
  if (stage === "connecting") {
    title = t("connect.connectingTitle");
    lede = input.fragment ? t("connect.ledeScanned") : t("connect.connectingLede");
    showInstall = false;
  } else if (stage === "approve") {
    title = t("connect.approveTitle");
    lede = t("connect.approveLede");
    showInstall = false;
  } else if (stage === "failed") {
    title = t("connect.failedTitle");
    lede = pageNotice?.tone === "error" ? pageNotice.text : t("connect.failedLede");
    ledeTone = "error";
    showInstall = false;
  } else if (pageNotice) {
    lede = pageNotice.text;
    ledeTone = pageNotice.tone === "error" ? "error" : "status";
    showInstall = false;
  }
  return {
    adding,
    busy,
    stage,
    backTitle: t("settings.addComputer"),
    title,
    lede,
    ledeTone,
    ledeKeycap: stage === "approve",
    showInstall,
    sheetOpen,
    sheetNotice: sheetOpen ? input.notice : null,
    pairCodeDraft: input.pairCodeDraft,
    pairCodeLength: length,
    pairCodeComplete: length === 14,
    pairCodeInvalid: input.pairErrorTarget === "code",
  };
}
