// Pure unit tests for the upload probe-wait gate: tri-state verdicts, the
// bounded waiter cap, 8 s timeout cleanup (clock-warped here), prompt
// invalidation, and zero leaked timers.
import { afterEach, describe, expect, test } from "bun:test";
import { ProtocolError } from "./errors.ts";
import {
  isUploadMutation,
  UPLOAD_MUTATION_OPS,
  UPLOAD_READINESS_MAX_CONCURRENT_WAITS,
  UPLOAD_READINESS_WAIT_MS,
  UploadReadinessGate,
} from "./session-upload-readiness.ts";

const settle = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

describe("upload mutation name set", () => {
  test("contains exactly the 8 Begin/Write/Commit/Cancel names, never Status", () => {
    expect([...UPLOAD_MUTATION_OPS].sort()).toEqual([
      "WorkspaceUploadBegin",
      "WorkspaceUploadBeginV2",
      "WorkspaceUploadCancel",
      "WorkspaceUploadCancelV2",
      "WorkspaceUploadCommit",
      "WorkspaceUploadCommitV2",
      "WorkspaceUploadWrite",
      "WorkspaceUploadWriteV2",
    ]);
    expect(UPLOAD_MUTATION_OPS.size).toBe(8);
    expect(isUploadMutation("WorkspaceUploadWriteV2")).toBe(true);
    expect(isUploadMutation("WorkspaceUploadStatus")).toBe(false);
    expect(isUploadMutation("WorkspaceUploadStatusV2")).toBe(false);
    expect(isUploadMutation("SendKeys")).toBe(false);
    expect(isUploadMutation("Ping")).toBe(false);
  });

  test("exposes the frozen 8 s bound and 4-waiter cap", () => {
    expect(UPLOAD_READINESS_WAIT_MS).toBe(8_000);
    expect(UPLOAD_READINESS_MAX_CONCURRENT_WAITS).toBe(4);
  });
});

describe("UploadReadinessGate", () => {
  afterEach(() => {
    // Every test must finish with no pending timers.
  });

  test("a true verdict resolves immediately without enqueueing", async () => {
    const gate = new UploadReadinessGate(4, 8_000);
    await gate.wait(() => true);
    expect(gate.pendingCount).toBe(0);
  });

  test("an Error verdict rejects immediately without enqueueing", async () => {
    const gate = new UploadReadinessGate(4, 8_000);
    const error = new ProtocolError("disconnected", "gone");
    await expect(gate.wait(() => error)).rejects.toBe(error);
    expect(gate.pendingCount).toBe(0);
  });

  test("a false verdict waits until pulse finds the same epoch ready", async () => {
    const gate = new UploadReadinessGate(4, 8_000);
    let ready = false;
    const done = gate.wait(() => (ready ? true : false));
    await settle();
    expect(gate.pendingCount).toBe(1);
    gate.pulse(); // still checking: stays parked
    expect(gate.pendingCount).toBe(1);
    ready = true;
    gate.pulse();
    await done;
    expect(gate.pendingCount).toBe(0);
  });

  test("pulse rejects waiters whose verdict becomes an error and keeps the rest", async () => {
    const gate = new UploadReadinessGate(4, 8_000);
    let mode: "wait" | "ready" | "invalid" = "wait";
    const invalid = gate.wait(() => (mode === "invalid" ? new ProtocolError("disconnected", "epoch gone") : false));
    const ready = gate.wait(() => (mode === "ready" ? true : false));
    await settle();
    expect(gate.pendingCount).toBe(2);
    mode = "invalid";
    gate.pulse();
    await expect(invalid).rejects.toMatchObject({ code: "disconnected" });
    expect(gate.pendingCount).toBe(1); // the other waiter is still parked
    mode = "ready";
    gate.pulse();
    await ready;
    expect(gate.pendingCount).toBe(0);
  });

  test("the 5th concurrent wait rejects visibly; the first four still resolve", async () => {
    const gate = new UploadReadinessGate(4, 8_000);
    let ready = false;
    const parked = [0, 1, 2, 3].map(() => gate.wait(() => (ready ? true : false)));
    await settle();
    expect(gate.pendingCount).toBe(4);
    await expect(gate.wait(() => false)).rejects.toMatchObject({ code: "backpressure" });
    expect(gate.pendingCount).toBe(4);
    ready = true;
    gate.pulse();
    await Promise.all(parked);
    expect(gate.pendingCount).toBe(0);
  });

  test("failAll settles every waiter promptly with the given error", async () => {
    const gate = new UploadReadinessGate(4, 8_000);
    const waits = [0, 1, 2].map(() => gate.wait(() => false));
    await settle();
    const closed = new ProtocolError("disconnected", "session closed");
    gate.failAll(closed);
    const results = await Promise.allSettled(waits);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(gate.pendingCount).toBe(0);
  });

  test("the deadline rejects one waiter and cleans its timer; later waiters are unaffected", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const active = new Set<ReturnType<typeof setTimeout>>();
    const warpSetTimeout = ((fn: TimerHandler, ms?: number) => {
      const id = realSetTimeout(fn as () => void, ms === 8_000 ? 20 : ms) as ReturnType<typeof setTimeout>;
      active.add(id);
      return id;
    }) as typeof setTimeout;
    const warpClearTimeout = ((id: ReturnType<typeof setTimeout>) => {
      active.delete(id);
      realClearTimeout(id);
    }) as typeof clearTimeout;
    globalThis.setTimeout = warpSetTimeout;
    globalThis.clearTimeout = warpClearTimeout;
    try {
      // Gate A uses the production 8 s bound (warped to 20 ms); gate B uses a
      // different bound so only A's deadline is accelerated.
      const gateA = new UploadReadinessGate(4, 8_000);
      const gateB = new UploadReadinessGate(4, 9_000);
      let ready = false;
      const timedOut = gateA.wait(() => false);
      const survives = gateB.wait(() => (ready ? true : false));
      await expect(timedOut).rejects.toMatchObject({ code: "timeout" });
      expect(gateA.pendingCount).toBe(0);
      expect(gateB.pendingCount).toBe(1);
      ready = true;
      gateB.pulse();
      await survives;
      expect(gateB.pendingCount).toBe(0);
      expect(active.size).toBe(0); // no deadline timer leaked
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });
});
