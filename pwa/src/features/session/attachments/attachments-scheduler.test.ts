import { describe, expect, test } from "bun:test";
import {
  createAttachmentScheduler,
  type AttachmentScheduler,
  type AttachmentSchedulerJob,
} from "./attachments-scheduler.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush the microtask queue a few times (promise chains are 1-3 ticks deep). */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

type Probe = {
  prepareCalls: number;
  runCalls: number;
  failedCalls: number;
  disposeCalls: number;
  received: unknown[];
  cancelled: boolean;
  prep: Deferred<unknown>;
  runDone: Deferred<void>;
  prepareError?: unknown;
  runError?: unknown;
  failedThrows?: boolean;
  disposeThrows?: boolean;
  /** Number of isCancelled observations made. */
  cancelChecks: number;
  /** When set, observations past this count return cancelled. */
  flipAfterChecks?: number;
  /** When set, observations past this count throw (guard failure). */
  throwAfterChecks?: number;
};

function makeProbe(label: string, value: unknown = `v:${label}`): Probe {
  return {
    prepareCalls: 0,
    runCalls: 0,
    failedCalls: 0,
    disposeCalls: 0,
    received: [],
    cancelled: false,
    prep: deferred<unknown>(),
    runDone: deferred<void>(),
    cancelChecks: 0,
  };
}

function probeJob(probe: Probe, active?: { current: number; max: number }): AttachmentSchedulerJob<unknown> {
  return {
    prepare: () => {
      probe.prepareCalls += 1;
      if (probe.prepareError !== undefined) return Promise.reject(probe.prepareError);
      return probe.prep.promise;
    },
    run: (value: unknown) => {
      probe.runCalls += 1;
      probe.received.push(value);
      if (active) {
        active.current += 1;
        active.max = Math.max(active.max, active.current);
      }
      if (probe.runError !== undefined) {
        const error = probe.runError;
        return Promise.resolve()
          .then(() => {
            if (active) active.current -= 1;
            throw error;
          });
      }
      return probe.runDone.promise.then(() => {
        if (active) active.current -= 1;
      });
    },
    failed: () => {
      probe.failedCalls += 1;
      if (probe.failedThrows) throw new Error("failed callback throws");
    },
    dispose: () => {
      probe.disposeCalls += 1;
      if (probe.disposeThrows) throw new Error("dispose callback throws");
    },
    isCancelled: () => {
      probe.cancelChecks += 1;
      if (
        probe.throwAfterChecks !== undefined &&
        probe.cancelChecks > probe.throwAfterChecks
      ) {
        throw new Error("cancel guard throws");
      }
      if (
        probe.flipAfterChecks !== undefined &&
        probe.cancelChecks > probe.flipAfterChecks
      ) {
        return true;
      }
      return probe.cancelled;
    },
  };
}

async function track(promise: Promise<void>): Promise<{ isDone: () => Promise<boolean> }> {
  let done = false;
  promise.then(() => {
    done = true;
  });
  return {
    isDone: async () => {
      await flush();
      return done;
    },
  };
}

describe("attachment scheduler — prepare window", () => {
  test("N+1 prepare overlaps the active run; N+2 waits until N finishes", async () => {
    const scheduler = createAttachmentScheduler();
    const net = { current: 0, max: 0 };
    const a = makeProbe("a");
    const b = makeProbe("b");
    const c = makeProbe("c");

    scheduler.enqueue(probeJob(a, net));
    await flush();
    expect(a.prepareCalls).toBe(1);

    a.prep.resolve("va");
    await flush();
    expect(a.runCalls).toBe(1); // own prepare resolved -> run starts
    expect(net.current).toBe(1);

    scheduler.enqueue(probeJob(b, net));
    await flush();
    expect(b.prepareCalls).toBe(1); // warmup starts while A run is active

    scheduler.enqueue(probeJob(c, net));
    await flush();
    expect(c.prepareCalls).toBe(0); // no third prepare while A still running

    a.runDone.resolve();
    await flush();
    expect(c.prepareCalls).toBe(1); // window slides only after A disposes
    expect(b.runCalls).toBe(0); // B's own prepare has not resolved yet

    b.prep.resolve("vb");
    await flush();
    expect(b.runCalls).toBe(1);
    expect(b.received[0]).toBe("vb");

    b.runDone.resolve();
    c.prep.resolve("vc");
    await flush();
    expect(c.runCalls).toBe(1);
    expect(c.received[0]).toBe("vc");

    c.runDone.resolve();
    await scheduler.settled();
    for (const p of [a, b, c]) {
      expect(p.prepareCalls).toBe(1); // every prepare invoked exactly once
      expect(p.runCalls).toBe(1);
      expect(p.disposeCalls).toBe(1);
    }
    expect(net.max).toBe(1); // network callbacks never overlap
  });

  test("runs stay FIFO even when the warmup prepare resolves first", async () => {
    const scheduler = createAttachmentScheduler();
    const order: string[] = [];
    const a = makeProbe("a");
    const b = makeProbe("b");
    const aJob = probeJob(a);
    const bJob = probeJob(b);
    aJob.run = async () => {
      order.push("a-run");
      await a.runDone.promise;
    };
    bJob.run = async () => {
      order.push("b-run");
      await b.runDone.promise;
    };

    scheduler.enqueue(aJob);
    scheduler.enqueue(bJob);
    await flush();

    b.prep.resolve("vb"); // warmup ready before the head
    await flush();
    expect(b.runCalls).toBe(0);

    a.prep.resolve("va");
    await flush();
    expect(order).toEqual(["a-run"]); // head runs first even though B was ready
    expect(b.runCalls).toBe(0);

    a.runDone.resolve();
    await flush();
    expect(order).toEqual(["a-run", "b-run"]);

    b.runDone.resolve();
    await scheduler.settled();
  });
});

describe("attachment scheduler — control priority", () => {
  test("control runs while a prepare is unresolved and before the run", async () => {
    const scheduler = createAttachmentScheduler();
    const log: string[] = [];
    const a = makeProbe("a");
    const aJob = probeJob(a);
    aJob.run = async () => {
      log.push("run");
      await a.runDone.promise;
    };
    scheduler.enqueue(aJob);
    await flush(); // A preparing, network slot idle

    const control = deferred<void>();
    scheduler.enqueueControl(() => {
      log.push("control");
      return control.promise;
    });
    await flush();
    expect(log).toEqual(["control"]); // not blocked by unresolved prepare
    expect(a.runCalls).toBe(0);

    control.resolve();
    a.prep.resolve("va");
    await flush();
    expect(log).toEqual(["control", "run"]);

    a.runDone.resolve();
    await scheduler.settled();
  });

  test("control queued in the same tick as readiness jumps the unstarted run", async () => {
    const scheduler = createAttachmentScheduler();
    const log: string[] = [];
    const a = makeProbe("a");
    const aJob = probeJob(a);
    aJob.run = async () => {
      log.push("run");
      await a.runDone.promise;
    };
    scheduler.enqueue(aJob);
    await flush();

    a.prep.resolve("va");
    scheduler.enqueueControl(async () => {
      log.push("control");
    });
    await flush();
    expect(log).toEqual(["control", "run"]);

    a.runDone.resolve();
    await scheduler.settled();
  });

  test("control never interrupts an active run", async () => {
    const scheduler = createAttachmentScheduler();
    const log: string[] = [];
    const a = makeProbe("a");
    const aJob = probeJob(a);
    aJob.run = async () => {
      log.push("run-start");
      await a.runDone.promise;
      log.push("run-end");
    };
    scheduler.enqueue(aJob);
    await flush();
    a.prep.resolve("va");
    await flush();
    expect(log).toContain("run-start");

    scheduler.enqueueControl(async () => {
      log.push("control");
    });
    await flush();
    expect(log).toEqual(["run-start"]); // waits behind the active run

    a.runDone.resolve();
    await flush();
    expect(log).toEqual(["run-start", "run-end", "control"]);
    await scheduler.settled();
  });
});

describe("attachment scheduler — failures", () => {
  test("prepare rejection reports failed once, disposes, and does not strand next", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    a.prepareError = new Error("prep boom");

    scheduler.enqueue(probeJob(a));
    scheduler.enqueue(probeJob(b));
    await flush();
    expect(a.failedCalls).toBe(1);
    expect(a.disposeCalls).toBe(1);
    expect(a.runCalls).toBe(0);
    expect(b.prepareCalls).toBe(1);

    b.prep.resolve("vb");
    await flush();
    b.runDone.resolve();
    await scheduler.settled();
    expect(b.runCalls).toBe(1);
    expect(b.failedCalls).toBe(0);
    expect(b.disposeCalls).toBe(1);
  });

  test("run rejection reports failed once, disposes, and the queue continues", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    a.runError = new Error("run boom");

    scheduler.enqueue(probeJob(a));
    scheduler.enqueue(probeJob(b));
    await flush();
    a.prep.resolve("va");
    await flush();
    expect(a.runCalls).toBe(1);
    a.runDone.resolve(); // the rejection path ignores this, but settle the deferred
    await flush();
    expect(a.failedCalls).toBe(1);
    expect(a.disposeCalls).toBe(1);

    b.prep.resolve("vb");
    await flush();
    b.runDone.resolve();
    await scheduler.settled();
    expect(b.runCalls).toBe(1);
    expect(b.disposeCalls).toBe(1);
  });

  test("a throwing prepare is contained like a rejection", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    const aJob = probeJob(a);
    aJob.prepare = () => {
      a.prepareCalls += 1;
      throw new Error("sync prep throw");
    };
    scheduler.enqueue(aJob);
    scheduler.enqueue(probeJob(b));
    await flush();
    expect(a.prepareCalls).toBe(1);
    expect(a.failedCalls).toBe(1);
    expect(a.disposeCalls).toBe(1);

    b.prep.resolve("vb");
    b.runDone.resolve();
    await scheduler.settled();
  });

  test("throwing failed/dispose callbacks and a throwing control task are contained", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    a.runError = new Error("run boom");
    a.failedThrows = true;
    a.disposeThrows = true;

    scheduler.enqueueControl(async () => {
      throw new Error("control boom");
    });
    scheduler.enqueue(probeJob(a));
    scheduler.enqueue(probeJob(b));
    await flush(); // failing control drains, prepares continue
    expect(b.prepareCalls).toBe(1);

    a.prep.resolve("va");
    a.runDone.resolve();
    await flush();
    expect(a.failedCalls).toBe(1); // throwing failed() is still called exactly once
    expect(a.disposeCalls).toBe(1); // throwing dispose() is still called exactly once

    b.prep.resolve("vb");
    b.runDone.resolve();
    await scheduler.settled();
    expect(b.runCalls).toBe(1);
    expect(b.disposeCalls).toBe(1);
  });
});

describe("attachment scheduler — cancellation", () => {
  test("job cancelled before enqueue (window full) is disposed immediately with no prepare", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    const c = makeProbe("c");
    c.cancelled = true;

    scheduler.enqueue(probeJob(a));
    scheduler.enqueue(probeJob(b));
    await flush();
    scheduler.enqueue(probeJob(c)); // pump culls the waiting cancelled job at once
    expect(c.prepareCalls).toBe(0);
    expect(c.runCalls).toBe(0);
    expect(c.disposeCalls).toBe(1);

    a.prep.resolve("va");
    b.prep.resolve("vb");
    await flush();
    a.runDone.resolve();
    await flush();
    b.runDone.resolve();
    await scheduler.settled();
  });

  test("queued cancellation observed at the next pump prevents prepare/run", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    const c = makeProbe("c");

    scheduler.enqueue(probeJob(a));
    a.prep.resolve("va");
    await flush(); // A running
    scheduler.enqueue(probeJob(b));
    scheduler.enqueue(probeJob(c));
    await flush();
    expect(b.prepareCalls).toBe(1);
    expect(c.prepareCalls).toBe(0);

    c.cancelled = true; // cancelled while waiting, before any observation
    a.runDone.resolve();
    await flush();
    expect(c.prepareCalls).toBe(0);
    expect(c.runCalls).toBe(0);
    expect(c.disposeCalls).toBe(1);

    b.prep.resolve("vb");
    await flush();
    b.runDone.resolve();
    await scheduler.settled();
  });

  test("warmup cancelled while preparing never runs, frees its slot after settle", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    const c = makeProbe("c");

    scheduler.enqueue(probeJob(a));
    a.prep.resolve("va");
    await flush(); // A running
    scheduler.enqueue(probeJob(b));
    await flush(); // B warmup preparing
    scheduler.enqueue(probeJob(c));
    await flush();
    expect(c.prepareCalls).toBe(0);

    b.cancelled = true; // scheduler must NOT fabricate an abort; prepare stays pending
    await flush();
    expect(b.disposeCalls).toBe(0); // observed only after the prepare settles
    expect(c.prepareCalls).toBe(0); // cancelled warmup keeps the slot until then

    b.prep.resolve("vb");
    await flush();
    expect(b.runCalls).toBe(0);
    expect(b.failedCalls).toBe(0);
    expect(b.disposeCalls).toBe(1);
    // B's slot freed: C slides into the one-ahead warmup even while A runs.
    expect(c.prepareCalls).toBe(1);

    a.runDone.resolve();
    await flush();
    expect(c.prepareCalls).toBe(1); // still invoked exactly once
    c.prep.resolve("vc");
    await flush();
    c.runDone.resolve();
    await scheduler.settled();
    expect(c.runCalls).toBe(1);
    expect(c.disposeCalls).toBe(1);
  });

  test("a prepare rejection after cancellation disposes without reporting failed", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    scheduler.enqueue(probeJob(a));
    await flush();
    a.cancelled = true;
    a.prep.reject(new Error("aborted by owner"));
    await flush();
    expect(a.failedCalls).toBe(0);
    expect(a.runCalls).toBe(0);
    expect(a.disposeCalls).toBe(1);
    await scheduler.settled();
  });

  test("a ready job cancelled before its network turn never runs", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");

    scheduler.enqueue(probeJob(a));
    a.prep.resolve("va");
    await flush(); // A running
    scheduler.enqueue(probeJob(b));
    await flush();
    b.prep.resolve("vb");
    await flush(); // B ready, waiting for the network slot
    expect(b.runCalls).toBe(0);

    b.cancelled = true;
    a.runDone.resolve();
    await flush();
    expect(b.runCalls).toBe(0);
    expect(b.disposeCalls).toBe(1);
    await scheduler.settled();
  });

  test("a guard that throws from the first observation fails closed at enqueue", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    a.throwAfterChecks = 0; // every observation throws
    scheduler.enqueue(probeJob(a)); // culled by the synchronous enqueue pump
    expect(a.prepareCalls).toBe(0);
    expect(a.disposeCalls).toBe(1);
    await flush();
    expect(a.runCalls).toBe(0);
    expect(a.failedCalls).toBe(0);
    await scheduler.settled();
  });

  test("a guard that starts throwing at prepare invocation fails closed", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    // Observation #1 (enqueue cull) is healthy; #2 (prepare-invocation
    // microtask) throws -> prepare is never called and the job disposes.
    a.throwAfterChecks = 1;
    scheduler.enqueue(probeJob(a));
    await flush();
    expect(a.prepareCalls).toBe(0);
    expect(a.runCalls).toBe(0);
    expect(a.failedCalls).toBe(0);
    expect(a.disposeCalls).toBe(1);
    await scheduler.settled();
  });

  test("synchronous cancellation right after enqueue skips prepare in its microtask", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    scheduler.enqueue(probeJob(a)); // pump scheduled the prepare; not invoked yet
    a.cancelled = true; // lands before the prepare-invocation microtask
    await flush();
    expect(a.prepareCalls).toBe(0);
    expect(a.runCalls).toBe(0);
    expect(a.failedCalls).toBe(0);
    expect(a.disposeCalls).toBe(1);

    // The prepare slot was released (settled can drain; no leaked counter):
    // a follow-up job prepares, runs and disposes normally.
    const b = makeProbe("b");
    scheduler.enqueue(probeJob(b));
    await flush();
    b.prep.resolve("vb");
    await flush();
    b.runDone.resolve();
    await scheduler.settled();
    expect(b.prepareCalls).toBe(1);
    expect(b.runCalls).toBe(1);
    expect(b.disposeCalls).toBe(1);
  });

  test("cancellation between ready dispatch and the run microtask skips run and frees the slot", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    // Observations before the run-invocation microtask, in order:
    // #1 enqueue cull, #2 prepare-invocation guard, #3 prepare-settle guard,
    // #4 ready cull, #5 dispatchNetwork slot check — all false; #6 (the
    // deferred run invocation) reads cancelled.
    a.flipAfterChecks = 5;

    scheduler.enqueue(probeJob(a));
    await flush();
    expect(a.prepareCalls).toBe(1);

    a.prep.resolve("va");
    await flush();
    expect(a.cancelChecks).toBe(6);
    expect(a.runCalls).toBe(0); // the run microtask re-read the guard
    expect(a.failedCalls).toBe(0);
    expect(a.disposeCalls).toBe(1);

    // The network slot was released: B runs without waiting on a stuck slot.
    scheduler.enqueue(probeJob(b));
    await flush();
    b.prep.resolve("vb");
    await flush();
    expect(b.runCalls).toBe(1);
    b.runDone.resolve();
    await scheduler.settled();
    expect(b.disposeCalls).toBe(1);
  });
});

describe("attachment scheduler — settled()", () => {
  test("does not resolve while a warmup prepare is outstanding", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    scheduler.enqueue(probeJob(a));
    scheduler.enqueue(probeJob(b));
    await flush();

    const isDone = await track(scheduler.settled());
    a.prep.resolve("va");
    await flush();
    a.runDone.resolve();
    await flush();
    expect(await isDone.isDone()).toBe(false); // B prepare still pending

    b.prep.resolve("vb");
    await flush();
    expect(await isDone.isDone()).toBe(false); // B run still pending
    b.runDone.resolve();
    await flush();
    expect(await isDone.isDone()).toBe(true);
  });

  test("waits for control tasks and for work enqueued during drain", async () => {
    const scheduler = createAttachmentScheduler();
    const a = makeProbe("a");
    const b = makeProbe("b");
    const control = deferred<void>();

    scheduler.enqueueControl(() => control.promise);
    const controlSettled = track(scheduler.settled());
    expect(await (await controlSettled).isDone()).toBe(false);
    control.resolve();

    const aJob = probeJob(a);
    aJob.run = async () => {
      // Enqueue new work from inside a draining network callback.
      scheduler.enqueue(probeJob(b));
      await a.runDone.promise;
    };
    scheduler.enqueue(aJob);
    await flush();
    a.prep.resolve("va");
    await flush();
    const settled = await track(scheduler.settled());
    a.runDone.resolve();
    await flush();
    expect(await settled.isDone()).toBe(false); // B was enqueued mid-drain

    b.prep.resolve("vb");
    await flush();
    b.runDone.resolve();
    await scheduler.settled();
    expect(b.runCalls).toBe(1);
    expect(b.disposeCalls).toBe(1);
  });

  test("resolves immediately when there is no work", async () => {
    const scheduler: AttachmentScheduler = createAttachmentScheduler();
    await scheduler.settled();
  });

  test("cancellation at any guard observation drains, including throwing guards", async () => {
    for (const throws of [false, true]) {
      for (let cancelAt = 1; cancelAt <= 10; cancelAt += 1) {
        const scheduler = createAttachmentScheduler();
        let checks = 0, cancelled = false, disposed = 0, done = false, failures = 0, ranCancelled = false;
        scheduler.enqueue({
          prepare: async () => undefined,
          run: async () => { ranCancelled ||= cancelled; },
          failed: () => { failures += 1; },
          dispose: () => { disposed += 1; },
          isCancelled: () => {
            cancelled ||= ++checks >= cancelAt;
            if (cancelled && throws) throw new Error("guard failed");
            return cancelled;
          },
        });
        void scheduler.settled().then(() => { done = true; });
        // No I/O or parked promises: let the finite microtask chain drain.
        // A regression fails an assertion instead of hanging on settled().
        for (let i = 0; i < 40; i += 1) await Promise.resolve();
        expect(disposed, `cancelAt=${cancelAt}, throws=${throws}`).toBe(1);
        expect(done, `cancelAt=${cancelAt}, throws=${throws}`).toBe(true);
        expect(failures).toBe(0);
        expect(ranCancelled).toBe(false);
      }
    }
  });
});
