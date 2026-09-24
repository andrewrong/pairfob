import { connectionDiagnostics, type ConnectionDiagnostic } from "../../lib/protocol/connection-diagnostics";

/**
 * Where a connection is stuck, read from the stages the protocol already
 * records (`connection-diagnostics`): phone → pairfob.com → the computer.
 *
 * - No `ws_open` yet: the phone has not reached pairfob.com.
 * - `ws_open` (and maybe `route_bound`) but no `session_ready`: pairfob.com
 *   is reached and the computer has not answered.
 *
 * The protocol layer only writes these records; this module only reads them,
 * so the connection path adds no protocol surface.
 */
export type PathHop = "relay" | "computer";

/** How long a connect may take before the list calls it slow. */
export const SLOW_CONNECT_MS = 8_000;

type RecordSource = () => readonly ConnectionDiagnostic[];
let recordSource: RecordSource = connectionDiagnostics;

/**
 * Stand in for the recorded stages (tests, and the QA fixture whose clock is
 * frozen). `null` restores the real diagnostics.
 */
export function setConnectionRecordSource(source: RecordSource | null): void {
  recordSource = source ?? connectionDiagnostics;
}

const STARTS = new Set(["connect_start", "warmup_start"]);
const DONE = new Set(["session_ready", "connect_failed"]);

/** Error codes that mean "could not reach", as opposed to refused, revoked or incompatible. */
const UNREACHABLE = new Set(["daemon_offline", "timeout", "disconnected"]);

function lastAttempt(records: readonly ConnectionDiagnostic[]): ConnectionDiagnostic[] {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (STARTS.has(records[index].event)) return records.slice(index);
  }
  return [];
}

function reachedRelay(attempt: readonly ConnectionDiagnostic[]): boolean {
  return attempt.some((record) => record.event === "ws_open" || record.event === "route_bound");
}

/** The hop an in-flight connect is waiting on, and since when; null when none is in flight. */
export function connectionWait(records: readonly ConnectionDiagnostic[] = recordSource()): { hop: PathHop; since: number } | null {
  const attempt = lastAttempt(records);
  if (!attempt.length || attempt.some((record) => DONE.has(record.event))) return null;
  return { hop: reachedRelay(attempt) ? "computer" : "relay", since: attempt[0].at };
}

/**
 * The hop a failed connect broke on, when the failure was about reaching
 * something; null when the failure was a refusal the computer page explains.
 */
export function unreachableHop(code: string, records: readonly ConnectionDiagnostic[] = recordSource()): PathHop | null {
  if (!UNREACHABLE.has(code)) return null;
  if (code === "daemon_offline") return "computer";
  return reachedRelay(lastAttempt(records)) ? "computer" : "relay";
}
