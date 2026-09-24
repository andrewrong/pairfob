import { recordConnectionDiagnostic } from "./connection-diagnostics";

export type RecoveryClock = () => { recovery_id?: number; recovery_elapsed_ms?: number };
let nextRecovery = Date.now();

/** One logical session's recovery, across old-path probe and relay retries. */
export class RecoveryDiagnostics {
  private clock: RecoveryClock | undefined;
  private active = false;

  start(): void {
    if (this.active) return;
    const id = ++nextRecovery;
    const started = performance.now();
    this.clock = () => ({ recovery_id: id, recovery_elapsed_ms: Math.max(0, performance.now() - started) });
    this.active = true;
    recordConnectionDiagnostic({ event: "recovery_start", ...this.clock() });
  }

  context = (): RecoveryClock | undefined => this.clock;

  /** A dial may survive hidden -> visible. Its stages use the current recovery;
   * connect_id still links stages belonging to that same underlying dial. */
  current: RecoveryClock = () => this.clock?.() ?? {};

  ready(): void {
    if (!this.active) return;
    this.active = false;
    recordConnectionDiagnostic({ event: "recovery_ready", ...this.clock?.() });
  }

  cancel(): void {
    if (this.active) recordConnectionDiagnostic({ event: "recovery_cancelled", ...this.clock?.() });
    this.active = false;
    this.clock = undefined;
  }
}
