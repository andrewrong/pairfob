import { describe, expect, test } from "bun:test";
import type { ConnectionDiagnostic } from "../../lib/protocol/connection-diagnostics";
import { connectionWait, unreachableHop } from "./connection-path";

const at = (event: string, ms: number, code?: string): ConnectionDiagnostic => ({ event, at: ms, ...(code ? { code } : {}) });

describe("where a connection is waiting", () => {
  test("before the socket opens it waits on pairfob.com, after it on the computer", () => {
    expect(connectionWait([at("connect_start", 100)])).toEqual({ hop: "relay", since: 100 });
    expect(connectionWait([at("connect_start", 100), at("ws_open", 300)])).toEqual({ hop: "computer", since: 100 });
    expect(connectionWait([at("warmup_start", 50), at("ws_open", 60), at("route_bound", 70)])).toEqual({ hop: "computer", since: 50 });
  });

  test("only the latest attempt counts, and a finished one is not waiting", () => {
    const earlier = [at("connect_start", 1), at("ws_open", 2), at("session_ready", 3)];
    expect(connectionWait(earlier)).toBeNull();
    expect(connectionWait([...earlier, at("connect_start", 10)])).toEqual({ hop: "relay", since: 10 });
    expect(connectionWait([at("connect_start", 1), at("connect_failed", 2, "timeout")])).toBeNull();
    expect(connectionWait([])).toBeNull();
  });
});

describe("where a failed connection broke", () => {
  test("the computer not being online is the computer's hop", () => {
    expect(unreachableHop("daemon_offline", [])).toBe("computer");
  });

  test("a timeout or drop is placed by whether pairfob.com was reached", () => {
    expect(unreachableHop("timeout", [at("connect_start", 1), at("connect_failed", 2, "timeout")])).toBe("relay");
    expect(unreachableHop("disconnected", [at("connect_start", 1), at("ws_open", 2), at("connect_failed", 3)])).toBe("computer");
  });

  test("a refusal is not a reachability problem", () => {
    for (const code of ["revoked", "fp_mismatch", "bad_relay", "incompatible", ""]) expect(unreachableHop(code, [])).toBeNull();
  });
});
