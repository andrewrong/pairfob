// Tests for the bounded in-flight V2 write window: hard cap of 4, fail-closed
// argument validation, contiguous-only progress on reordered replies, and
// stop-on-first-error/abort with every launched promise observed.
import { describe, expect, test } from "bun:test";
import { ProtocolError } from "./protocol/errors.ts";
import {
  pumpWindowedUpload,
  UPLOAD_WINDOW_MAX_IN_FLIGHT,
  type WindowWrite,
} from "./attachment-window.ts";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const tick = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

/** All started sends block on gates the test releases explicitly. */
class Gates {
  private readonly gates = new Map<number, { resolve: (end: number) => void; reject: (error: unknown) => void }>();
  readonly started: WindowWrite[] = [];
  active = 0;
  maxActive = 0;

  send = (write: WindowWrite): Promise<number> => {
    this.started.push(write);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<number>((resolve, reject) => {
      this.gates.set(write.offset, { resolve, reject });
    }).finally(() => {
      this.active -= 1;
    });
  };

  release(offset: number): void {
    const end = this.started.find((w) => w.offset === offset)!.end;
    this.gates.get(offset)!.resolve(end);
    this.gates.delete(offset);
  }

  /** Releases every send currently holding a gate; returns the released count. */
  releaseReady(): number {
    const offsets = [...this.gates.keys()];
    for (const offset of offsets) this.release(offset);
    return offsets.length;
  }

  fail(offset: number, error: unknown): void {
    this.gates.get(offset)!.reject(error);
    this.gates.delete(offset);
  }
}

describe("pumpWindowedUpload concurrency cap", () => {
  test("never runs more than 4 writes simultaneously (10 chunks)", async () => {
    const gates = new Gates();
    const done = pumpWindowedUpload(100, 0, 10, 4, { send: gates.send });
    await tick();
    expect(gates.active).toBe(4);
    expect(gates.maxActive).toBe(UPLOAD_WINDOW_MAX_IN_FLIGHT);
    expect(gates.started.map((w) => w.offset)).toEqual([0, 10, 20, 30]);
    expect(gates.releaseReady()).toBe(4);
    await tick();
    // Completing the first wave launches the rest, still capped at 4.
    expect(gates.maxActive).toBe(4);
    expect(gates.started.map((w) => w.offset)).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    gates.releaseReady();
    await tick();
    expect(gates.started.map((w) => w.offset)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    gates.releaseReady();
    expect(await done).toBe(100);
    expect(gates.active).toBe(0);
  });

  test("clamps a caller ask of 8 down to the wire maximum of 4", async () => {
    const gates = new Gates();
    const done = pumpWindowedUpload(100, 0, 10, 8, { send: gates.send });
    await tick();
    expect(gates.active).toBe(4);
    expect(gates.maxActive).toBe(UPLOAD_WINDOW_MAX_IN_FLIGHT);
    gates.releaseReady();
    await tick();
    expect(gates.maxActive).toBe(4);
    gates.releaseReady();
    await tick();
    gates.releaseReady();
    expect(await done).toBe(100);
  });

  test.each([NaN, Infinity, -Infinity, 0, -1, 1.5])("rejects maxInFlight %p before any send", async (bad) => {
    const gates = new Gates();
    await expect(pumpWindowedUpload(40, 0, 10, bad, { send: gates.send })).rejects.toBeInstanceOf(ProtocolError);
    await expect(pumpWindowedUpload(40, 0, 10, bad, { send: gates.send })).rejects.toMatchObject({ code: "conflict" });
    expect(gates.started).toHaveLength(0);
  });

  test("rejects unsafe size/fromOffset/chunkBytes without sending", async () => {
    const send = async (): Promise<number> => {
      throw new Error("must not send");
    };
    await expect(pumpWindowedUpload(NaN, 0, 10, 4, { send })).rejects.toMatchObject({ code: "conflict" });
    await expect(pumpWindowedUpload(40, -1, 10, 4, { send })).rejects.toMatchObject({ code: "conflict" });
    await expect(pumpWindowedUpload(40, 41, 10, 4, { send })).rejects.toMatchObject({ code: "conflict" });
    await expect(pumpWindowedUpload(40, 0, 0, 4, { send })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("pumpWindowedUpload chunking and progress", () => {
  test("sends exact slices including a partial final chunk", async () => {
    const writes: WindowWrite[] = [];
    const result = await pumpWindowedUpload(25, 0, 10, 4, {
      send: async (write) => {
        writes.push(write);
        return write.end;
      },
    });
    expect(result).toBe(25);
    expect(writes).toEqual([
      { offset: 0, end: 10 },
      { offset: 10, end: 20 },
      { offset: 20, end: 25 },
    ]);
  });

  test("empty range performs no sends and reports the starting offset", async () => {
    const progress: number[] = [];
    const result = await pumpWindowedUpload(0, 0, 10, 4, {
      send: async () => {
        throw new Error("must not send");
      },
      onProgress: (ack) => progress.push(ack),
    });
    expect(result).toBe(0);
    expect(progress).toEqual([0]);
  });

  test("reordered replies advance only the contiguous acknowledged prefix", async () => {
    const gates = new Gates();
    const progress: number[] = [];
    const done = pumpWindowedUpload(40, 0, 10, 4, { send: gates.send, onProgress: (ack) => progress.push(ack) });
    await tick();
    expect(gates.started.map((w) => w.offset)).toEqual([0, 10, 20, 30]);

    // Last chunk confirms first: no contiguous progress may jump.
    gates.release(30);
    await tick();
    expect(progress).toEqual([0]);

    gates.release(0);
    await tick();
    expect(progress).toEqual([0, 10]);

    gates.release(10);
    await tick();
    expect(progress).toEqual([0, 10, 20]);

    gates.release(20);
    expect(await done).toBe(40);
    expect(progress).toEqual([0, 10, 20, 40]);
  });

  test("resumes from a non-zero offset without re-sending acknowledged bytes", async () => {
    const writes: WindowWrite[] = [];
    const result = await pumpWindowedUpload(40, 20, 10, 4, {
      send: async (write) => {
        writes.push(write);
        return write.end;
      },
    });
    expect(result).toBe(40);
    expect(writes).toEqual([
      { offset: 20, end: 30 },
      { offset: 30, end: 40 },
    ]);
  });
});

describe("pumpWindowedUpload failure and abort", () => {
  test("a send whose receipt end mismatches is a conflict after the window settles", async () => {
    const result = await pumpWindowedUpload(20, 0, 10, 4, {
      send: async (write) => (write.offset === 0 ? 99 : write.end),
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(ProtocolError);
    expect((result as ProtocolError).code).toBe("conflict");
  });

  test("first rejection stops new launches but still waits for the other in-flight sends", async () => {
    const gates = new Gates();
    let settled = 0;
    const send = async (write: WindowWrite): Promise<number> => {
      const promise = gates.send(write).finally(() => {
        settled += 1;
      });
      if (write.offset === 0) {
        // Reject on a microtask AFTER all four launches of this window.
        queueMicrotask(() => gates.fail(0, new ProtocolError("unknown_op", "boom")));
      }
      return promise;
    };
    const done = pumpWindowedUpload(80, 0, 10, 4, { send });
    await tick(8);
    expect(gates.started.map((w) => w.offset)).toEqual([0, 10, 20, 30]);

    // The failing send settles; the pump must not abandon the other three.
    await delay(0);
    expect(gates.active).toBe(3);
    expect(gates.started).toHaveLength(4);

    for (const offset of [10, 20, 30]) gates.release(offset);
    const error = await done.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).code).toBe("unknown_op");
    expect(settled).toBe(4);
    expect(gates.active).toBe(0);
    // Second wave never launched.
    expect(gates.started.map((w) => w.offset)).toEqual([0, 10, 20, 30]);
  });

  test("pre-aborted pump launches nothing and rejects AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    const gates = new Gates();
    const result = await pumpWindowedUpload(40, 0, 10, 4, { signal: controller.signal, send: gates.send }).then(
      () => null,
      (error: unknown) => error,
    );
    expect((result as DOMException).name).toBe("AbortError");
    expect(gates.started).toHaveLength(0);
  });

  test("abort after the first wave launches no second wave and settles the window", async () => {
    const controller = new AbortController();
    const gates = new Gates();
    const done = pumpWindowedUpload(80, 0, 10, 4, { signal: controller.signal, send: gates.send });
    await tick();
    expect(gates.started.map((w) => w.offset)).toEqual([0, 10, 20, 30]);
    controller.abort();
    for (const offset of [0, 10, 20, 30]) gates.release(offset);
    const result = await done.then(
      () => null,
      (error: unknown) => error,
    );
    expect((result as DOMException).name).toBe("AbortError");
    expect(gates.started.map((w) => w.offset)).toEqual([0, 10, 20, 30]);
    expect(gates.active).toBe(0);
  });
});
