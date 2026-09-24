import { describe, expect, test } from "bun:test";
import { STOP_WATCH_MS, StopFlow, sendKind, stopPhaseFor, type SendInput, type StopKey, type StopOutcome } from "./session-stop";

/** A flow on fake ports: status, owner and timers are all under the test's hand. */
function harness() {
  const status = new Map<string, boolean | null>([["p1", true]]);
  let owner = "p1";
  let now = 0;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const watchers = new Set<() => void>();
  const outcomes: StopOutcome[] = [];
  const keys: StopKey[] = [];
  let changes = 0;
  const flow = new StopFlow({
    working: (paneId) => status.get(paneId) ?? null,
    ownerActive: (paneId) => owner === paneId,
    watch: (onChange) => {
      watchers.add(onChange);
      return () => { watchers.delete(onChange); };
    },
    schedule: (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return timer;
    },
    cancel: (handle) => { (handle as { live: boolean }).live = false; },
    report: (outcome) => { outcomes.push(outcome); },
    onChange: () => { changes++; },
  });
  const target = { paneId: "p1", sendKey: (key: StopKey) => { keys.push(key); } };
  return {
    flow,
    target,
    keys,
    outcomes,
    watchers,
    changes: () => changes,
    setStatus(paneId: string, working: boolean | null) {
      status.set(paneId, working);
      for (const watcher of [...watchers]) watcher();
    },
    setOwner(paneId: string) {
      owner = paneId;
      for (const watcher of [...watchers]) watcher();
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (timer.live && timer.at <= now) {
          timer.live = false;
          timer.run();
        }
      }
    },
  };
}

describe("stop flow", () => {
  test("a tap sends Esc once and settles as stopped when the pane leaves working", () => {
    const h = harness();
    h.flow.start(h.target);
    expect(h.keys).toEqual(["esc"]);
    expect(h.flow.snapshot()).toEqual({ phase: "stopping", paneId: "p1" });
    h.setStatus("p1", false);
    expect(h.flow.snapshot().phase).toBe("idle");
    expect(h.outcomes).toEqual(["stopped"]);
    expect(h.watchers.size).toBe(0);
    h.advance(STOP_WATCH_MS);
    expect(h.outcomes).toEqual(["stopped"]);
  });

  test("still working after the watch window offers force stop; Ctrl+C only on the second tap", () => {
    const h = harness();
    h.flow.start(h.target);
    h.advance(STOP_WATCH_MS - 1);
    expect(h.flow.snapshot().phase).toBe("stopping");
    h.advance(1);
    expect(h.flow.snapshot().phase).toBe("stuck");
    expect(h.outcomes).toEqual(["stuck"]);
    // Nothing more is sent on its own, however long it stays stuck.
    h.advance(STOP_WATCH_MS * 3);
    expect(h.keys).toEqual(["esc"]);
    h.flow.force();
    expect(h.keys).toEqual(["esc", "ctrl+c"]);
    expect(h.flow.snapshot().phase).toBe("forcing");
    h.setStatus("p1", false);
    expect(h.outcomes).toEqual(["stuck", "stopped"]);
    expect(h.flow.snapshot().phase).toBe("idle");
  });

  test("force stop that does not stop reports failure and sends nothing else", () => {
    const h = harness();
    h.flow.start(h.target);
    h.advance(STOP_WATCH_MS);
    h.flow.start(h.target);
    expect(h.keys).toEqual(["esc", "ctrl+c"]);
    h.advance(STOP_WATCH_MS);
    expect(h.outcomes).toEqual(["stuck", "failed"]);
    expect(h.flow.snapshot().phase).toBe("idle");
    expect(h.keys).toEqual(["esc", "ctrl+c"]);
  });

  test("a stuck pane that stops by itself still settles as stopped", () => {
    const h = harness();
    h.flow.start(h.target);
    h.advance(STOP_WATCH_MS);
    h.setStatus("p1", false);
    expect(h.outcomes).toEqual(["stuck", "stopped"]);
    expect(h.flow.snapshot().phase).toBe("idle");
  });

  test("leaving the pane or losing status cancels without a verdict", () => {
    const h = harness();
    h.flow.start(h.target);
    h.setOwner("p2");
    expect(h.flow.snapshot().phase).toBe("idle");
    h.advance(STOP_WATCH_MS);
    expect(h.outcomes).toEqual([]);

    h.setOwner("p1");
    h.flow.start(h.target);
    h.setStatus("p1", null);
    expect(h.flow.snapshot().phase).toBe("idle");
    h.advance(STOP_WATCH_MS);
    expect(h.outcomes).toEqual([]);
    expect(h.watchers.size).toBe(0);
  });

  test("does not start on a pane that is not working, and ignores repeated taps while stopping", () => {
    const h = harness();
    h.setStatus("p1", false);
    h.flow.start(h.target);
    expect(h.keys).toEqual([]);
    h.setStatus("p1", true);
    h.flow.start(h.target);
    h.flow.start(h.target);
    h.flow.force();
    expect(h.keys).toEqual(["esc"]);
  });

  test("a key that fails to send cancels the flow", async () => {
    const h = harness();
    h.flow.start({ paneId: "p1", sendKey: async () => { throw new Error("offline"); } });
    expect(h.flow.snapshot().phase).toBe("stopping");
    await Promise.resolve();
    await Promise.resolve();
    expect(h.flow.snapshot().phase).toBe("idle");
    h.advance(STOP_WATCH_MS);
    expect(h.outcomes).toEqual([]);
  });

  test("another pane's leftover phase reads as idle", () => {
    expect(stopPhaseFor({ phase: "stuck", paneId: "p1" }, "p2")).toBe("idle");
    expect(stopPhaseFor({ phase: "stuck", paneId: "p1" }, "p1")).toBe("stuck");
  });
});

describe("send button kind", () => {
  const base: SendInput = { hasText: false, ready: 0, submitting: false, waiting: false, live: false, working: false, stop: "idle" };

  test("empty is Enter, content is send", () => {
    expect(sendKind(base)).toBe("enter");
    expect(sendKind({ ...base, hasText: true })).toBe("send");
    expect(sendKind({ ...base, ready: 2 })).toBe("send");
    expect(sendKind({ ...base, hasText: true, submitting: true })).toBe("busy");
  });

  test("stop only for an empty message on a working pane outside live input", () => {
    expect(sendKind({ ...base, working: true })).toBe("stop");
    expect(sendKind({ ...base, working: true, hasText: true })).toBe("send");
    expect(sendKind({ ...base, working: true, ready: 1 })).toBe("send");
    // A file still uploading (or failed) is part of the message: the button sends and waits, never stops.
    expect(sendKind({ ...base, working: true, unfinished: 1 })).toBe("send");
    expect(sendKind({ ...base, working: true, live: true })).toBe("enter");
  });

  test("the stop flow and upload wait take the button over", () => {
    expect(sendKind({ ...base, working: true, stop: "stopping" })).toBe("stopping");
    expect(sendKind({ ...base, working: true, stop: "forcing", hasText: true })).toBe("stopping");
    expect(sendKind({ ...base, working: true, stop: "stuck" })).toBe("force");
    expect(sendKind({ ...base, working: false, stop: "stuck" })).toBe("enter");
    expect(sendKind({ ...base, hasText: true, waiting: true })).toBe("wait");
  });
});
