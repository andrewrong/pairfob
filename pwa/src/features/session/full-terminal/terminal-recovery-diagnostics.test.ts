import { expect, test } from "bun:test";
import { TerminalRecoveryDiagnostics } from "./terminal-recovery-diagnostics";
import { connectionDiagnostics } from "../../../lib/protocol/connection-diagnostics";

test("each reopened terminal reports its first frame once under its captured recovery", () => {
  let id = 101;
  const capture = () => { const captured = id; return () => ({ recovery_id: captured, recovery_elapsed_ms: 50 }); };
  const first = new TerminalRecoveryDiagnostics(capture());
  first.opened(); first.firstFrame(); first.firstFrame();
  id++;
  const second = new TerminalRecoveryDiagnostics(capture());
  second.opened(); second.firstFrame();
  for (const recovery of [101, 102]) {
    expect(connectionDiagnostics().filter(r => r.recovery_id === recovery).map(r => r.event))
      .toEqual(["terminal_open_start", "terminal_open_ready", "terminal_first_frame"]);
  }
});
