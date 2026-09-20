/**
 * Tests for the injectable monotonic stage clock (attachments-timing.ts).
 *
 * The clock records ELAPSED ms only: compression is bracketed by its caller
 * around a real smart prepare; the transfer onStage observer opens
 * hashing/begin/sending/commit/status; checkpointEntry() stops hashing at
 * onCheckpoint entry (before an IndexedDB await); a resume with no
 * checkpoint closes its open hash at the next stage. A non-finite or
 * backwards clock reading is never published, and timings() returns copies.
 */
import { describe, expect, test } from "bun:test";
import {
  createAttachmentStageClock,
  type AttachmentStageClock,
} from "./attachments-timing.ts";

/** Deterministic monotonic clock the test can drive. */
function fakeClock(start = 1000): {
  clock: AttachmentStageClock;
  advance: (ms: number) => void;
  setNow: (value: number) => void;
} {
  let value = start;
  return {
    clock: createAttachmentStageClock(() => value),
    advance: (ms: number) => {
      value += ms;
    },
    setNow: (next: number) => {
      value = next; // NaN / Infinity / a backwards value are allowed here
    },
  };
}

describe("compression then hashing are measured separately", () => {
  test("a real smart prepare brackets compression; hashing ends at checkpoint entry", () => {
    const { clock, advance } = fakeClock();
    clock.begin("compression");
    advance(30);
    expect(clock.end("compression")).toBe(30);

    clock.observeTransferStage("hashing");
    advance(40);
    expect(clock.checkpointEntry()).toBeUndefined();
    expect(clock.timings()).toEqual({ compression: 30, hashing: 40 });
  });

  test("checkpointEntry ends hashing BEFORE a long persistence (IDB) wait", () => {
    const { clock, advance } = fakeClock();
    clock.observeTransferStage("hashing");
    advance(40);
    clock.checkpointEntry(); // controller calls this before its first await

    // The IndexedDB persistence await happens while NO stage is open: its
    // time is attributed to neither hashing nor the network stages.
    advance(5000);

    clock.observeTransferStage("begin");
    advance(5);
    clock.observeTransferStage("sending");
    advance(100);
    clock.observeTransferStage("commit");
    advance(7);
    clock.end("commit");

    expect(clock.timings()).toEqual({
      hashing: 40,
      begin: 5,
      sending: 100,
      commit: 7,
    });
  });
});

describe("network stages measure only their own elapsed time", () => {
  test("fresh upload: hash -> begin -> sending -> commit exact durations", () => {
    const { clock, advance } = fakeClock();
    clock.observeTransferStage("hashing");
    advance(10);
    clock.checkpointEntry();

    clock.observeTransferStage("begin");
    advance(4);
    clock.observeTransferStage("sending");
    advance(50);
    clock.observeTransferStage("commit");
    advance(6);
    expect(clock.end("commit")).toBe(6);

    expect(clock.timings()).toEqual({
      hashing: 10,
      begin: 4,
      sending: 50,
      commit: 6,
    });
  });

  test("empty file (no sending stage): begin is closed by commit", () => {
    const { clock, advance } = fakeClock();
    clock.observeTransferStage("hashing");
    advance(11);
    clock.checkpointEntry();

    clock.observeTransferStage("begin");
    advance(4);
    clock.observeTransferStage("commit"); // opening commit closes open begin
    advance(2);
    clock.end("commit");

    expect(clock.timings()).toEqual({ hashing: 11, begin: 4, commit: 2 });
    expect("sending" in clock.timings()).toBe(false);
  });
});

describe("resume has no onCheckpoint", () => {
  test("status -> hash -> sending closes durations with no checkpoint call", () => {
    const { clock, advance } = fakeClock();
    clock.observeTransferStage("status");
    advance(3);
    expect(clock.end("status")).toBe(3);

    clock.observeTransferStage("hashing");
    advance(12);
    // No checkpointEntry(): the sending observation must close the open hash.
    clock.observeTransferStage("sending");
    advance(20);
    clock.observeTransferStage("commit");
    advance(2);
    clock.end("commit");

    expect(clock.timings()).toEqual({
      status: 3,
      hashing: 12,
      sending: 20,
      commit: 2,
    });
    expect("begin" in clock.timings()).toBe(false);
  });

  test("an open hash is also closed when a resume goes straight to begin", () => {
    const { clock, advance } = fakeClock();
    clock.observeTransferStage("hashing");
    advance(9);
    clock.observeTransferStage("begin");
    advance(1);
    clock.observeTransferStage("commit");
    advance(1);
    clock.end("commit");
    expect(clock.timings().hashing).toBe(9);
    expect(clock.timings().begin).toBe(1);
  });
});

describe("stage start retention and no-op ends", () => {
  test("repeating the SAME open stage keeps its original start", () => {
    const { clock, advance } = fakeClock();
    clock.begin("compression");
    advance(5);
    clock.begin("compression"); // duplicate signal, not a restart
    advance(5);
    expect(clock.end("compression")).toBe(10);

    // A duplicate hashing observer keeps the first start too.
    clock.observeTransferStage("hashing");
    advance(3);
    clock.observeTransferStage("hashing");
    advance(3);
    clock.checkpointEntry();
    expect(clock.timings().hashing).toBe(6);
  });

  test("opening a different stage closes the open one and keeps its duration", () => {
    const { clock, advance } = fakeClock();
    clock.begin("compression");
    advance(3);
    clock.begin("hashing"); // auto-closes compression
    advance(7);
    clock.checkpointEntry();
    expect(clock.timings()).toEqual({ compression: 3, hashing: 7 });
  });

  test("end on a stage that is not open is a no-op and leaves it unmeasured", () => {
    const { clock, advance } = fakeClock();
    expect(clock.end("commit")).toBeUndefined();
    expect(clock.timings()).toEqual({});

    clock.begin("compression");
    advance(4);
    expect(clock.end("hashing")).toBeUndefined(); // wrong stage: nothing closed
    expect(clock.end("compression")).toBe(4); // still open, still measurable
  });

  test("checkpointEntry is a no-op unless hashing is open (begin is left running)", () => {
    const { clock, advance } = fakeClock();
    clock.observeTransferStage("begin");
    advance(2);
    clock.checkpointEntry(); // must not close begin
    advance(3);
    clock.observeTransferStage("sending");
    expect(clock.timings().begin).toBe(5);
  });
});

describe("non-finite and backwards clock readings are never published", () => {
  test("a backwards jump while open records no duration", () => {
    const { clock, advance, setNow } = fakeClock(1000);
    clock.begin("compression");
    advance(10);
    setNow(500); // clock moved backwards
    expect(clock.end("compression")).toBeUndefined();
    expect("compression" in clock.timings()).toBe(false);
  });

  test("NaN / Infinity elapsed readings record nothing, then the clock recovers", () => {
    const { clock, advance, setNow } = fakeClock(1000);
    clock.observeTransferStage("sending");
    setNow(Number.NaN);
    clock.observeTransferStage("commit"); // drop sending (NaN), open commit
    setNow(3000);
    clock.begin("status"); // drop commit (its start was NaN too), open status
    advance(5);
    expect(clock.end("status")).toBe(5);

    const timings = clock.timings();
    expect("sending" in timings).toBe(false);
    expect("commit" in timings).toBe(false);
    expect(timings.status).toBe(5);

    // Infinity is equally rejected.
    clock.begin("hashing");
    setNow(Number.POSITIVE_INFINITY);
    clock.checkpointEntry();
    expect("hashing" in clock.timings()).toBe(false);
  });
});

describe("timings snapshots", () => {
  test("returned snapshots are copies: caller mutation never reaches the clock", () => {
    const { clock, advance } = fakeClock();
    clock.begin("compression");
    advance(3);
    clock.end("compression");

    const first = clock.timings();
    first.compression = 999; // mutate the caller's copy
    delete (first as Partial<typeof first>).compression;

    clock.observeTransferStage("hashing");
    advance(8);
    clock.checkpointEntry();

    const second = clock.timings();
    expect(second.compression).toBe(3); // untouched by the caller's mutation
    expect(second.hashing).toBe(8);
    expect("hashing" in first).toBe(false); // first snapshot is not retroactively filled
  });
});

describe("detail / original rows get no invented compression timing", () => {
  test("a passthrough caller that never brackets compression shows no such field", () => {
    const { clock, advance } = fakeClock();
    // Detail/original/failed-compress rows skip compression entirely; the
    // caller therefore never calls begin("compression"), and the clock must
    // not invent a field for it.
    clock.observeTransferStage("hashing");
    advance(10);
    clock.checkpointEntry();
    clock.observeTransferStage("begin");
    advance(2);
    clock.observeTransferStage("sending");
    advance(20);
    clock.observeTransferStage("commit");
    advance(1);
    clock.end("commit");

    const timings = clock.timings();
    expect("compression" in timings).toBe(false);
    expect(timings).toEqual({ hashing: 10, begin: 2, sending: 20, commit: 1 });
  });
});


test("local persistence is measured independently of hashing and network stages", () => {
  const { clock, advance } = fakeClock();
  clock.observeTransferStage("hashing"); advance(10); clock.checkpointEntry();
  clock.begin("persistence"); advance(125); clock.end("persistence");
  clock.observeTransferStage("begin"); advance(8); clock.observeTransferStage("sending");
  expect(clock.timings()).toEqual({ hashing: 10, persistence: 125, begin: 8 });
});
