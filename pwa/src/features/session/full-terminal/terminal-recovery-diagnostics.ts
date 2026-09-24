import { recordConnectionDiagnostic } from "../../../lib/protocol/connection-diagnostics";
import type { RecoveryClock } from "../../../lib/protocol/recovery-diagnostics";

/** One bridge open and its first applied frame, not the screen's lifetime. */
export class TerminalRecoveryDiagnostics {
  private readonly started = performance.now();
  private painted = false;
  constructor(private readonly recovery?: RecoveryClock) { this.record("terminal_open_start"); }
  opened(): void { this.record("terminal_open_ready"); }
  firstFrame(): void {
    if (this.painted) return;
    this.painted = true;
    this.record("terminal_first_frame");
  }
  private record(event: string): void {
    if (this.recovery) recordConnectionDiagnostic({
      event, ...this.recovery(), elapsed_ms: Math.max(0, performance.now() - this.started),
    });
  }
}
