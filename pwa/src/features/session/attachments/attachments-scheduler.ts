/**
 * Pure one-network / one-ahead scheduler for attachment uploads.
 *
 * The scheduler owns ONLY ordering and concurrency. It holds no source bytes,
 * workers, timers, stores, RPC clients, globals, or cancellation signals —
 * every side effect lives in the job callbacks supplied by the controller,
 * which also owns guards/abort and invokes this scheduler.
 *
 * Pipeline (FIFO):
 * - a job first runs `prepare()` (off-network work, e.g. image compression);
 *   the current job and at most ONE following ("warmup") job may be preparing
 *   concurrently, and each prepare is invoked exactly once;
 * - a job's `run(value)` network callback starts only after its own prepare
 *   resolves, and never after `isCancelled()` has been observed true;
 * - at most ONE network callback (a run or a control task) is active at a
 *   time; control tasks have priority over unstarted run callbacks and are not
 *   blocked by an unresolved prepare, but they never interrupt an active run;
 * - no third prepare starts until the current job has run and disposed (a
 *   cancelled in-flight warmup keeps its prepare slot until it settles).
 *
 * Cancellation is pull-based: the scheduler only learns cancellation by
 * calling `isCancelled()` at its observation points (pump ticks, the deferred
 * prepare/run invocation microtasks, and promise settlements). It never
 * fabricates an abort — a preparing/running callback that must stop owns its
 * own abort. A cancellation landing after scheduling but before the deferred
 * callback invokes still skips that callback. Observed cancellation:
 * - before prepare started: prepare/run skipped, `dispose()` called once;
 * - while preparing: run never starts; the slot frees when prepare settles,
 *   then dispose runs once (no `failed` report for a cancelled job);
 * - while running: the run is left to settle on its own; dispose runs once
 *   after it settles.
 *
 * Any callback may throw synchronously or reject; such failures are
 * contained: `failed` (when appropriate) once, `dispose` exactly once, and
 * the queue continues. `settled()` resolves only after every job, warmup,
 * run, and control task known at resolution time has drained — including work
 * enqueued from inside a draining callback.
 */

/** A single FIFO upload job. Generic over the prepare product. */
export type AttachmentSchedulerJob<T> = {
  /** Off-network preparation; invoked at most once. */
  prepare: () => Promise<T>;
  /** Network callback; invoked once with the prepared value. */
  run: (value: T) => Promise<void>;
  /** Reports a prepare/run failure; invoked at most once, errors contained. */
  failed: (error: unknown) => void;
  /** Releases every resource owned by the job; invoked exactly once. */
  dispose: () => void;
  /** Pull-based cancellation probe; a throwing guard fails closed (cancelled). */
  isCancelled: () => boolean;
};

/** A network control callback (pause/cancel/flush RPC and the like). */
export type AttachmentControlTask = () => Promise<void>;

export interface AttachmentScheduler {
  enqueue<T>(job: AttachmentSchedulerJob<T>): void;
  enqueueControl(task: AttachmentControlTask): void;
  /** Resolves once all known jobs/control tasks/prepares/runs have drained. */
  settled(): Promise<void>;
}

/** At most one prepare for the current job plus one warmup. */
const MAX_PREPARING = 2;

/** Internal outcome marking a prepare callback skipped by a pre-invocation guard. */
const PREPARE_SKIPPED: unique symbol = Symbol("attachment-prepare-skipped");

type JobPhase = "waiting" | "preparing" | "ready" | "running";

type InternalJob = AttachmentSchedulerJob<unknown> & {
  phase: JobPhase;
  /** Set once prepare has resolved and the job has not been cancelled. */
  value?: unknown;
  disposed: boolean;
};

export function createAttachmentScheduler(): AttachmentScheduler {
  /** FIFO of jobs that have not reached their terminal dispose. */
  const jobs: InternalJob[] = [];
  /** Control tasks, older first; drained before unstarted run callbacks. */
  const controls: AttachmentControlTask[] = [];
  let preparingCount = 0;
  let networkBusy = false;
  const idleWaiters: Array<() => void> = [];

  /**
   * Cancellation probe, fail closed: a throwing guard is read as cancelled so
   * a broken guard can never trigger unexpected prepare/run work.
   */
  function isCancelled(job: InternalJob): boolean {
    try {
      return job.isCancelled();
    } catch {
      return true;
    }
  }

  /** Invoke a void callback, containing any synchronous throw. */
  function safeCall(callback: () => void): void {
    try {
      callback();
    } catch {
      // Controller-owned callback errors must never poison the scheduler.
    }
  }

  /** Terminal transition: dispose exactly once and drop from the FIFO. */
  function disposeJob(job: InternalJob): void {
    const index = jobs.indexOf(job);
    if (index >= 0) jobs.splice(index, 1);
    if (job.disposed) return;
    job.disposed = true;
    safeCall(() => job.dispose());
  }

  function reportFailure(job: InternalJob, error: unknown): void {
    // A job already observed cancelled is being torn down by its own owner;
    // reporting it as failed would double-report a user-driven cancellation.
    if (isCancelled(job)) return;
    safeCall(() => job.failed(error));
  }

  function startPrepare(job: InternalJob): void {
    job.phase = "preparing";
    preparingCount += 1;
    // Promise.resolve().then turns a synchronous throw into a rejection, but
    // the deferred invocation also opens a microtask gap: cancellation may
    // land after the pump scheduled this job yet before prepare() runs. The
    // guard is re-read in the invocation microtask, and a cancelled job never
    // invokes prepare; the prepare slot is released in the settle handler.
    Promise.resolve()
      .then((): unknown => {
        if (isCancelled(job)) return PREPARE_SKIPPED;
        return job.prepare();
      })
      .then(
        (value: unknown) => {
          preparingCount -= 1;
          if (value === PREPARE_SKIPPED || isCancelled(job)) {
            // Cancelled (or a failing guard) before/while preparing: no run.
            disposeJob(job);
          } else {
            job.value = value;
            job.phase = "ready";
          }
          pump();
        },
        (error: unknown) => {
          preparingCount -= 1;
          if (!isCancelled(job)) reportFailure(job, error);
          disposeJob(job);
          pump();
        },
      );
  }

  function startRun(job: InternalJob): void {
    job.phase = "running";
    networkBusy = true;
    const value = job.value;
    Promise.resolve()
      .then(() => {
        // Re-read the guard in the invocation microtask. dispatchNetwork
        // scheduled this run from its own (earlier) guard check; a cancel
        // landing in between must release the network slot without run().
        if (isCancelled(job)) return;
        return job.run(value);
      })
      .then(
        () => {
          networkBusy = false;
          disposeJob(job);
          pump();
        },
        (error: unknown) => {
          networkBusy = false;
          if (!isCancelled(job)) reportFailure(job, error);
          disposeJob(job);
          pump();
        },
      );
  }

  function startControl(task: AttachmentControlTask): void {
    networkBusy = true;
    Promise.resolve()
      .then(task)
      .then(
        () => {
          networkBusy = false;
          pump();
        },
        () => {
          // A failing control task is contained; later work still proceeds.
          networkBusy = false;
          pump();
        },
      );
  }

  /**
   * Drop waiting/ready jobs already observed cancelled. A prepare is never
   * allocated for a waiting job and a ready job never starts its run.
   */
  function cullCancelled(): void {
    for (const job of [...jobs]) {
      if (job.phase === "waiting" || job.phase === "ready") {
        if (isCancelled(job)) disposeJob(job);
      }
    }
  }

  /**
   * Start prepares for the FIFO prefix while a slot is free. Started jobs
   * form a strict prefix: a later job cannot prepare ahead of an earlier
   * waiting job. A cancelled prepare still in flight pins the window until it
   * settles, so its slot is not reused early ("frees after prepare settles").
   */
  function startPrepares(): void {
    const pinned = jobs.some(
      (job) => job.phase === "preparing" && isCancelled(job),
    );
    if (pinned) return;
    // Started jobs (preparing/ready/running) each occupy a window slot, so a
    // waiting job starts only within the first two positions; the loop stops
    // at the first blocked job (later jobs may never jump the FIFO gap).
    let occupied = 0;
    for (const job of jobs) {
      if (job.phase !== "waiting") {
        occupied += 1;
        continue;
      }
      if (occupied >= MAX_PREPARING) break;
      startPrepare(job);
      occupied += 1;
    }
  }

  /**
   * Dispatch the single network slot: control tasks first (never queued
   * behind an unresolved prepare), otherwise the FIFO head's run once it is
   * ready. A preparing head blocks later ready jobs — runs stay in order.
   */
  function dispatchNetwork(): void {
    if (networkBusy) return;
    const control = controls.shift();
    if (control !== undefined) {
      startControl(control);
      return;
    }
    const head = jobs[0];
    if (head && head.phase === "ready") {
      if (isCancelled(head)) {
        disposeJob(head);
        // A guard can change after culling. Dispose now and advance on the
        // next microtask; disposal may itself enqueue work or a control task.
        queueMicrotask(pump);
        return;
      }
      startRun(head);
    }
  }

  function isIdle(): boolean {
    return jobs.length === 0
      && controls.length === 0
      && preparingCount === 0
      && !networkBusy;
  }

  /** Advance every independent stage; resolve settled() waiters when idle. */
  function pump(): void {
    cullCancelled();
    startPrepares();
    dispatchNetwork();
    if (isIdle() && idleWaiters.length > 0) {
      const waiters = idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  function enqueue<T>(job: AttachmentSchedulerJob<T>): void {
    const internal: InternalJob = {
      prepare: job.prepare as () => Promise<unknown>,
      run: job.run as (value: unknown) => Promise<void>,
      failed: job.failed,
      dispose: job.dispose,
      isCancelled: job.isCancelled,
      phase: "waiting",
      disposed: false,
    };
    jobs.push(internal);
    pump();
  }

  function enqueueControl(task: AttachmentControlTask): void {
    controls.push(task);
    pump();
  }

  function settled(): Promise<void> {
    if (isIdle()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      idleWaiters.push(resolve);
    });
  }

  return { enqueue, enqueueControl, settled };
}
