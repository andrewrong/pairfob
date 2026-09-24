import { t } from "./i18n.ts";
import { openPairingScanner, type ScanResult } from "./pairing-scanner-view.tsx";

export { PairingScanError } from "./pairing-scanner-view.tsx";

/** A browser without camera access still opens the sheet, which explains why and offers the code. */
export async function scanPairingCode(expectedOrigin: string): Promise<ScanResult> {
  const unavailable = !navigator.mediaDevices?.getUserMedia ? t("scan.noCamera") : "";
  return openPairingScanner(expectedOrigin, undefined, unavailable);
}
