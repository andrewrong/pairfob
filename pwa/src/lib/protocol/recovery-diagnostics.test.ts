import { expect, test, spyOn } from "bun:test";
import { RecoveryDiagnostics } from "./recovery-diagnostics";
import { connectionDiagnostics, recordConnectionDiagnostic } from "./connection-diagnostics";

test("recovery correlates retries, deduplicates starts, and captures independent epochs", () => {
  let now = 100;
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  try {
    const recovery = new RecoveryDiagnostics();
    recovery.start();
    const first = recovery.context()!;
    recovery.start();
    expect(recovery.context()).toBe(first);
    now = 250;
    recovery.ready(); recovery.ready();
    const records = connectionDiagnostics().filter(r => r.recovery_id === first().recovery_id);
    expect(records.map(r => r.event)).toEqual(["recovery_start", "recovery_ready"]);
    expect(records[1]!.recovery_elapsed_ms).toBe(150);
    recovery.start();
    expect(recovery.context()!().recovery_id).not.toBe(first().recovery_id);
    expect(first().recovery_elapsed_ms).toBe(150);
    recovery.cancel();
    expect(recovery.context()).toBeUndefined();
    recordConnectionDiagnostic({ event: "recovery_ready", recovery_id: Infinity, recovery_elapsed_ms: -1 });
    expect(connectionDiagnostics().at(-1)?.recovery_id).toBeUndefined();
    expect(connectionDiagnostics().at(-1)?.recovery_elapsed_ms).toBeUndefined();
  } finally { clock.mockRestore(); }
});
