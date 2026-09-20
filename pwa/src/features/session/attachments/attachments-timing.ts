/**
 * Monotonic stage clocks for one attachment transfer attempt.
 *
 * The sheet's transfer details show real, measured per-stage durations —
 * compression, hashing, begin, sending, commit (and the read-only status
 * check). Every duration is an ELAPSED reading from an injectable monotonic
 * clock: this module never invents a value, never attributes one stage's time
 * to another, and a backwards/non-finite clock records nothing.
 *
 * Accuracy rules honored by the call sites (phase B wires these into the
 * transfer options):
 * - compression is measured ONLY around a real smart-image preparation.
 *   Detail/original/passthrough rows never call begin("compression"), so no
 *   fictitious compression timing is shown for them;
 * - onStage("hashing") begins the hash clock before the actual SHA;
 * - the hash clock stops at onCheckpoint ENTRY — onCheckpoint runs AFTER the
 *   SHA and may then await IndexedDB persistence. That IDB wait must never be
 *   counted as hashing or as network time, so the controller calls
 *   `checkpointEntry()` before its first await;
 * - begin starts only on onStage("begin"); sending ends begin; commit ends
 *   sending; the caller ends commit/status when the RPC actually settles;
 * - a resume has no onCheckpoint, so an open hash clock ends at the next
 *   begin/sending/commit stage observation.
 *
 * Pure and framework-free: one clock instance per attempt, discarded when the
 * attempt settles. Observer callbacks are sync and cheap.
 */
import type { AttachmentTransferStage } from "./attach-model";

/** Stages that can carry a measured duration in the row details. */
export type AttachmentTimingStage =
  | "persistence"
  | "compression"
  | "hashing"
  | "begin"
  | "sending"
  | "commit"
  | "status";

/** Elapsed milliseconds per completed stage; absent stages were never measured. */
export type AttachmentStageTimings = Partial<Record<AttachmentTimingStage, number>>;

export type AttachmentStageClock = {
  /**
   * Open a stage, recording its monotonic start. Opening a different stage
   * while one is still open ends the open one first (its duration is kept).
   */
  begin(stage: AttachmentTimingStage): void;
  /**
   * Close an open stage and keep its elapsed ms. No-op (returns undefined)
   * when that stage is not the open one or the reading is not a finite,
   * non-negative elapsed — the stage simply stays unmeasured.
   */
  end(stage: AttachmentTimingStage): number | undefined;
  /**
   * Feed a transfer `onStage` callback. Mapping:
   * hashing → open hash; begin → close hash (resume), open begin;
   * sending → close hash/begin, open sending; commit → close sending, open
   * commit; status → open status.
   */
  observeTransferStage(stage: AttachmentTransferStage): void;
  /**
   * Stop the hash clock at onCheckpoint ENTRY, before any persistence await.
   * No-op unless hashing is the open stage.
   */
  checkpointEntry(): void;
  /** A copy of every completed-stage duration recorded so far. */
  timings(): AttachmentStageTimings;
};

export function createAttachmentStageClock(
  now: () => number = () => globalThis.performance.now(),
): AttachmentStageClock {
  const timings: AttachmentStageTimings = {};
  let openStage: AttachmentTimingStage | null = null;
  let openSince = 0;

  function closeOpen(): void {
    if (openStage === null) return;
    const stage = openStage;
    const elapsed = now() - openSince;
    openStage = null;
    // Monotonic elapsed only: a clock jump backwards or a non-finite reading
    // leaves the stage unmeasured rather than recording a fabricated number.
    if (Number.isFinite(elapsed) && elapsed >= 0) timings[stage] = elapsed;
  }

  function begin(stage: AttachmentTimingStage): void {
    if (openStage === stage) return; // already measuring: keep the original start
    closeOpen();
    openStage = stage;
    openSince = now();
  }

  function end(stage: AttachmentTimingStage): number | undefined {
    if (openStage !== stage) return undefined;
    closeOpen();
    return timings[stage];
  }

  function checkpointEntry(): void {
    if (openStage === "hashing") end("hashing");
  }

  function observeTransferStage(stage: AttachmentTransferStage): void {
    switch (stage) {
      case "hashing":
        begin("hashing");
        return;
      case "begin":
        // Fresh uploads already closed hashing at onCheckpoint entry; a resume
        // has no checkpoint, so close a still-open hash here.
        if (openStage === "hashing") end("hashing");
        begin("begin");
        return;
      case "sending":
        if (openStage === "hashing" || openStage === "begin") end(openStage);
        begin("sending");
        return;
      case "commit":
        if (openStage === "hashing" || openStage === "sending") end(openStage);
        begin("commit");
        return;
      case "status":
        begin("status");
        return;
    }
  }

  return {
    begin,
    end,
    observeTransferStage,
    checkpointEntry,
    timings: () => ({ ...timings }),
  };
}
