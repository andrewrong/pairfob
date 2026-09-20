import { ATTEMPT_FIELDS_CLEARED, findItem, ownsGeneration, isActiveStatus, formatLimit, applyTerminalState, isExpiredError, handleExpiredHandle, retainUnresolvedCancel, demoteOnInactiveGate } from "./attachments-transfer-state";
/**
 * Attachment orchestration: bounded upload scheduling, explicit cancel /
 * status-check / resume, and row removal.
 *
 * Shared scope/session/capability gates and the transfer-port resolver live
 * in attachments-context.ts (re-exported below); native-pick adoption lives
 * in attachments-picking.ts; image-edit adoption in attachments-edit.ts;
 * draft insertion in attachments-insertion.ts; durable recovery in
 * attachments-recovery.ts; monotonic stage clocks in attachments-timing.ts.
 *
 * Hard rules enforced here:
 * - require a live authorized pane and upload capability; preparation and
 *   new sends also require P2P, otherwise retain the row for manual restart;
 * - uploads run through the pure one-network / one-ahead scheduler: a row is
 *   claimed synchronously (per-item generation + AbortController) and stays
 *   visibly queued+scheduled until ITS preparation starts;
 * - every gate (source / generation / owner scope / capability / session) is
 *   re-checked after every await and immediately before Begin;
 * - final network admission counts ACTUAL bytes only (the current prepared
 *   file + other committed actuals + retained checkpoint actuals) — never
 *   unprepared queued-source estimates;
 * - onCheckpoint retains the handle synchronously, closes the hash clock, and
 *   awaits the durable journal write BEFORE Begin; a storage failure warns
 *   but still allows the upload;
 * - a queued/no-checkpoint cancel is exact locally and immediate (no Begin
 *   can have happened); a checkpoint cancel reconciles through one priority
 *   control task; mutations never replay automatically.
 */
import { liveSession } from "../../computers/catalog-store";
import { sessionTransport } from "../../connection/connection-store";
import { haptic } from "../../../lib/dom";
import { messageOf } from "../../../lib/notices";
import { preserveReason } from "../../../lib/attachment-image-policy";
import { attachT } from "./attach-copy";
import {
  ownerStillValid,
  requireAttachmentP2P,
  AttachmentP2PUnavailable,
  scopeMatches,
  transferPort,
  uploadFileEnabled,
} from "./attachments-context";
// Public gate/port surface re-exported here so existing module imports of the
// controller keep working after the context extraction.
export {
  attachmentsAllowed,
  attachmentDisplayLimits,
  currentAttachmentScope,
  setAttachmentTransferPort,
} from "./attachments-context";
import {
  isAbortError,
  uploadErrorPatch,
  type AttachmentCheckpoint,
  type AttachmentItem,
  type AttachmentScope,
  type AttachmentTransferStage,
  type AnyLiveSession,
} from "./attach-model";
import {
  abortAttachment,
  attachmentScopeKey,
  bumpRuntimeGeneration,
  clearRuntimeCheckpoint,
  patchItem,
  queueSnapshot,
  removeAttachment as removeRow,
  runtimeAbort,
  runtimeCheckpoint,
  runtimeFile,
  runtimeGeneration,
  runtimePhotoOrigin,
  runtimePreparedImage,
  runtimeRemoved,
  setQueueNotice,
  setRuntimeAbort,
  setRuntimeCheckpoint,
} from "./attachments-store";
import {
  createAttachmentProgressMeter,
  type AttachmentProgressMeter,
  type AttachmentProgressSnapshot,
} from "./attachments-progress";
import { prepareFreshImage } from "./attachments-image";
import { createAttachmentScheduler } from "./attachments-scheduler";
import { createAttachmentStageClock, type AttachmentStageClock } from "./attachments-timing";
import {
  exceedsFinalFileLimit,
  finalAdmissionAllowed,
  FINAL_MAX_BATCH_BYTES,
  FINAL_MAX_FILE_BYTES,
} from "./attachments-admission";
import {
  persistAttachmentCheckpoint,
  requestRowDelete,
  scheduleAttachmentPersist,
} from "./attachments-recovery";

// --- Bounded scheduler (one network run, at most one warmup preparation) ----------

const scheduler = createAttachmentScheduler();

/** Test/teardown helper: wait until every queued job/control task settles. */
export function settleTransferQueue(): Promise<void> {
  return scheduler.settled();
}

// --- Picking -----------------------------------------------------------------------
// Native-pick adoption (local intake limits, readiness re-read, File-object
// dedup) split by duty into attachments-picking.ts; re-exported so existing
// module imports of the controller are unchanged.
export { addPickedFiles } from "./attachments-picking";

// --- Shared row helpers ------------------------------------------------------------

// --- One upload attempt (prepare + run) as a scheduler job ------------------------

type TransferKind = "upload" | "resume";

/**
 * The meter for one attempt. Every publish re-checks the generation and the
 * row state: a superseded attempt, a removed row, or a non-uploading row is
 * never touched by a timer.
 */
function createRowMeter(key: string, localId: string, generation: number, total: number, signal: AbortSignal): AttachmentProgressMeter {
  return createAttachmentProgressMeter({
    total,
    signal,
    emit: (snapshot: AttachmentProgressSnapshot) => {
      if (!ownsGeneration(key, localId, generation)) return;
      const current = findItem(key, localId);
      if (!current || (current.status !== "preparing" && current.status !== "uploading")) return;
      const acknowledged = Math.max(current.acknowledged, Math.min(snapshot.acknowledged, current.size));
      patchItem(key, localId, {
        status: "uploading",
        acknowledged,
        waiting: snapshot.waiting,
        speedBps: snapshot.speedBps,
        etaSeconds: snapshot.etaSeconds,
      });
    },
  });
}

/**
 * Enqueue one upload attempt. The claim (generation + AbortController) was
 * installed synchronously by startUpload/resumeUpload and is NEVER replaced
 * here. prepare runs off-network (smart compression) for the head and at most
 * one warmup row; its File result is produced once and handed to run, which is
 * the only place the network is touched.
 */
function enqueueUploadJob(
  scope: AttachmentScope,
  localId: string,
  kind: TransferKind,
  session: AnyLiveSession,
  generation: number,
): void {
  const key = attachmentScopeKey(scope);
  const clock: AttachmentStageClock = createAttachmentStageClock();
  const claimedAbort = runtimeAbort(key, localId);
  if (!claimedAbort) return; // claim was invalidated before enqueue
  const abort = claimedAbort;
  let meter: AttachmentProgressMeter | null = null;

  scheduler.enqueue<File | null>({
    isCancelled: () => !ownsGeneration(key, localId, generation),

    prepare: async () => {
      if (!ownsGeneration(key, localId, generation) || abort.signal.aborted) return null;
      requireAttachmentP2P();
      const before = findItem(key, localId);
      if (!before) return null;
      // Resume trivially prepares the EXACT checkpoint file: status is read
      // first in run, never recompressed.
      if (kind === "resume") {
        patchItem(key, localId, { status: "preparing" });
        if (!runtimeCheckpoint(key, localId)) return null;
        return runtimeFile(key, localId);
      }
      // Only an actual uncached smart-photo candidate brackets the compression
      // clock + phase: the SHARED preserveReason policy (with the trusted photo
      // origin) decides candidacy, and detail/original/non-image/cached rows are
      // excluded. Non-candidates never show a fictitious compression.
      const smart = before.kind === "image"
        && (before.compressionMode ?? "smart") === "smart"
        && (before.imageIntent ?? "photo") === "photo"
        && !runtimePreparedImage(key, localId)
        && preserveReason({ name: before.name, type: before.mime, size: before.size }, runtimePhotoOrigin(key, localId)) === null;
      patchItem(key, localId, { status: "preparing", transferPhase: smart ? "compressing" : undefined });
      if (smart) clock.begin("compression");
      const prepared = await prepareFreshImage(
        scope, localId, generation, abort.signal, () => ownerStillValid(scope, session),
      );
      if (smart) clock.end("compression");
      if (!ownsGeneration(key, localId, generation) || abort.signal.aborted) return null;
      if (!ownerStillValid(scope, session) || prepared === null) {
        demoteOnInactiveGate(key, localId);
        return null;
      }
      // Prepare settled: clear the live compressing flag and park the row on the
      // existing "queued" phase while it waits for the network slot. Status stays
      // preparing/scheduled until the upload truly begins; queued is an existing
      // enum (no new waiting value is added).
      patchItem(key, localId, { compressing: false, transferPhase: "queued", stageTimings: clock.timings() });
      return prepared;
    },

    run: async (preparedFile) => {
      const file = preparedFile;
      if (!file) return; // prepare refused (stale/demoted); it already settled the row
      if (!ownsGeneration(key, localId, generation) || abort.signal.aborted) return;
      requireAttachmentP2P();
      const port = await transferPort();
      // Revalidate after the lazy-import boundary.
      if (!ownsGeneration(key, localId, generation) || abort.signal.aborted) return;
      if (!ownerStillValid(scope, session)) {
        demoteOnInactiveGate(key, localId);
        return;
      }
      requireAttachmentP2P();
      const uploadFile = kind === "resume" ? runtimeFile(key, localId) : file;
      if (!uploadFile) return;

      // FINAL network admission on ACTUAL bytes only. The current job counts
      // its prepared size; OTHER committed rows contribute their real upload
      // sizes; retained checkpoints (uncertain handles included) contribute
      // their actual sizes. Unprepared queued SOURCE estimates are never
      // summed, so three 21 MiB JPEGs compressing to 1 MiB each all fit.
      const committedActual: number[] = [];
      const checkpointActual: number[] = [];
      for (const row of queueSnapshot(key)?.items ?? []) {
        if (row.localId === localId) continue; // own checkpoint excluded too
        if (row.status === "committed") committedActual.push(row.size);
        const otherCheckpoint = runtimeCheckpoint(key, row.localId);
        if (otherCheckpoint) checkpointActual.push(otherCheckpoint.size);
      }
      const admitted = !exceedsFinalFileLimit(uploadFile.size)
        && finalAdmissionAllowed({
          currentBytes: uploadFile.size,
          committedActual,
          checkpointActual,
        }, FINAL_MAX_BATCH_BYTES);
      if (!admitted) {
        // Oversized actual upload (e.g. detail/original/failed-compression
        // over 20 MiB) or a 40 MiB actual batch: honest error BEFORE hash/Begin.
        const current = findItem(key, localId);
        const errorText = exceedsFinalFileLimit(uploadFile.size, FINAL_MAX_FILE_BYTES)
          ? attachT("err.fileTooLarge", { name: current?.name ?? uploadFile.name, limit: formatLimit(FINAL_MAX_FILE_BYTES) })
          : attachT("err.batchTooLarge", { limit: formatLimit(FINAL_MAX_BATCH_BYTES) });
        patchItem(key, localId, {
          status: "error",
          recoverable: false,
          cancelIntent: false,
          errorText,
          ...ATTEMPT_FIELDS_CLEARED,
        });
        haptic(2);
        return;
      }

      // The network slot is really this row's now: capture the transport at
      // this instant (never a claim about the whole historical route).
      patchItem(key, localId, { scheduled: false, transferTransport: sessionTransport() });
      meter = createRowMeter(key, localId, generation, uploadFile.size, abort.signal);
      const options = {
        signal: abort.signal,
        onProgress: (acknowledged: number) => meter?.observe(acknowledged),
        onStage: (stage: AttachmentTransferStage) => {
          if (!ownsGeneration(key, localId, generation)) return;
          const current = findItem(key, localId);
          if (!current || (current.status !== "preparing" && current.status !== "uploading")) return;
          clock.observeTransferStage(stage);
          patchItem(key, localId, { transferPhase: stage, stageTimings: clock.timings() });
        },
        onCheckpoint: async (checkpoint: AttachmentCheckpoint) => {
          const current = findItem(key, localId);
          // This callback runs BEFORE Begin, so a stale/cancelled attempt must
          // never install a handle it no longer owns. Any gate failure aborts
          // the CAPTURED controller explicitly before setting the checkpoint —
          // returning alone is unsafe because replaceRuntimeFile clears the
          // runtime abort without firing this captured one. The library's
          // post-callback abort check then stops Begin and failed() demotes the
          // still-owned row.
          if (!ownsGeneration(key, localId, generation)
              || abort.signal.aborted
              || !ownerStillValid(scope, session)
              || runtimeFile(key, localId) !== uploadFile) {
            abort.abort();
            return;
          }
          requireAttachmentP2P();
          setRuntimeCheckpoint(key, localId, checkpoint);
          // Hash clock stops HERE, before the persistence await — the IndexedDB
          // wait is never counted as hashing or network time.
          clock.checkpointEntry();
          if (current && (current.status === "preparing" || current.status === "uploading")) {
            patchItem(key, localId, { status: "uploading", transferPhase: "persisting", acknowledged: Math.max(current.acknowledged, 0), stageTimings: clock.timings() });
          }
          // Full source/upload/item/checkpoint record before Begin. A failure
          // only warns; it never blocks the upload.
          clock.begin("persistence");
          try { await persistAttachmentCheckpoint(scope, localId); }
          finally {
            clock.end("persistence");
            if (ownsGeneration(key, localId, generation)) patchItem(key, localId, { stageTimings: clock.timings() });
          }
          // Re-check EVERY gate after the persistence wait: a stale attempt must
          // never let Begin through. ANY failure aborts the captured controller
          // so the library's post-callback abort check stops Begin; failed()
          // then demotes (checkpoint retained).
          if (!ownsGeneration(key, localId, generation)
              || abort.signal.aborted
              || !ownerStillValid(scope, session)
              || runtimeFile(key, localId) !== uploadFile) {
            abort.abort();
          }
          if (!abort.signal.aborted) requireAttachmentP2P();
        },
      };
      const state = kind === "upload"
        ? await port.upload(session, scope.paneId, uploadFile, options)
        : await port.resume(session, runtimeCheckpoint(key, localId)!, uploadFile, options);
      meter.flush();
      // Close whichever live stage remains (commit for normal completion;
      // hashing for a resume that found the file already committed) and
      // publish the measured durations BEFORE the terminal state clears the
      // live phase, so the details stay available on the finished row.
      for (const openStage of ["commit", "sending", "hashing", "begin", "status"] as const) clock.end(openStage);
      if (ownsGeneration(key, localId, generation)) {
        patchItem(key, localId, { stageTimings: clock.timings() });
      }
      if (!ownsGeneration(key, localId, generation)) {
        // A cancel superseded this attempt. A committed result is immutable
        // truth and wins; anything else is settled by the cancel control task.
        if (state.state === "committed") {
          const fresh = findItem(key, localId);
          if (fresh) applyTerminalState(scope, key, localId, fresh, state);
        }
        return;
      }
      const fresh = findItem(key, localId);
      if (fresh) applyTerminalState(scope, key, localId, fresh, state);
    },

    failed: (error) => {
      meter?.flush();
      if (!ownsGeneration(key, localId, generation)) return; // cancel settles it
      const current = findItem(key, localId);
      if (!current) return;
      if (error instanceof AttachmentP2PUnavailable) {
        // This local gate runs before Begin, never after sending a mutation.
        if (kind === "upload") clearRuntimeCheckpoint(key, localId);
        patchItem(key, localId, {
          ...ATTEMPT_FIELDS_CLEARED,
          status: runtimeCheckpoint(key, localId) ? "error" : "queued",
          recoverable: !!runtimeCheckpoint(key, localId), errorText: "",
          transferPhase: "waiting-p2p",
        });
        scheduleAttachmentPersist(scope, localId);
        return;
      }
      if (isAbortError(error)) {
        // A still-owned attempt arriving here aborted via OUR checkpoint gate
        // (a real user cancel bumps the generation and is handled above). Demote
        // and clear the live phase even if the gate has become valid again —
        // otherwise the self-aborted row would be left stranded mid-upload.
        demoteOnInactiveGate(key, localId);
        return;
      }
      if (isExpiredError(error)) { handleExpiredHandle(scope, key, localId); return; }
      patchItem(key, localId, {
        ...uploadErrorPatch(current, error, messageOf),
        ...ATTEMPT_FIELDS_CLEARED,
      });
    },

    dispose: () => {
      meter?.dispose();
      if (runtimeAbort(key, localId) === abort) setRuntimeAbort(key, localId, null);
      // A cull before prepare (cancel/remove) changes the generation; only a
      // still-owned row gets its scheduled flag cleared here.
      if (ownsGeneration(key, localId, generation)) {
        patchItem(key, localId, { scheduled: false });
      }
    },
  });
}

// --- Public start / cancel / check / resume / remove ------------------------------

/** Begin a fresh upload. Queued, cancelled and failed rows start here. */
export function startUpload(scope: AttachmentScope, localId: string): void {
  const key = attachmentScopeKey(scope);
  const item = findItem(key, localId);
  const file = runtimeFile(key, localId);
  if (!item || !file) return;
  if (isActiveStatus(item)) return; // a claim already exists: double click is a no-op
  if (item.scheduled) return; // already queued for the bounded scheduler
  if (item.cancelIntent) return; // only explicit check/cancel may touch this row
  if (item.status === "committed") return; // already on disk
  if (item.status === "error" && item.recoverable) return; // use resumeUpload
  // While any checkpoint remains, reconcile first — never abandon the handle.
  if (runtimeCheckpoint(key, localId)) return;
  const session = liveSession();
  if (!scopeMatches(scope) || !uploadFileEnabled() || !session) {
    setQueueNotice(key, attachT("err.gate"));
    return;
  }
  // Synchronous claim: generation + abort installed BEFORE any await and
  // before enqueue, so a second click / cancel cannot duplicate or replace it.
  const generation = bumpRuntimeGeneration(key, localId);
  if (generation === null) return;
  setRuntimeAbort(key, localId, new AbortController());
  // Stay visibly queued+scheduled until THIS row's preparation starts.
  patchItem(key, localId, {
    status: "queued",
    scheduled: true,
    transferPhase: "queued",
    acknowledged: 0,
    errorText: "",
    recoverable: false,
    cancelIntent: false,
    path: "",
    inserted: false,
    speedBps: undefined,
    etaSeconds: undefined,
    waiting: false,
  });
  enqueueUploadJob(scope, localId, "upload", session, generation);
}

/** Schedule every ready queued row; the bounded scheduler runs them serially. */
export function startAllQueued(scope: AttachmentScope): void {
  const key = attachmentScopeKey(scope);
  for (const item of queueSnapshot(key)?.items ?? []) {
    if (item.status === "queued" && !item.scheduled && !item.cancelIntent) {
      startUpload(scope, item.localId);
    }
  }
}

/**
 * Explicit cancel. The row generation is bumped and the attempt aborted
 * synchronously. WITHOUT a checkpoint no Begin could have happened, so the
 * row is cancelled locally and its journal record deleted immediately — never
 * parked behind another file's transfer. WITH a checkpoint, one priority
 * control task reconciles (cancel, then one read-only inspect on uncertain
 * effect) and at most one cancel mutation is sent.
 */
export function cancelUpload(scope: AttachmentScope, localId: string): void {
  const key = attachmentScopeKey(scope);
  const item = findItem(key, localId);
  if (!item) return;
  if (item.status === "committed" || item.status === "cancelled") return;
  if (item.status === "cancelling") return; // one cancel at a time
  const session = liveSession();
  const generation = bumpRuntimeGeneration(key, localId);
  if (generation === null) return;
  abortAttachment(key, localId);
  const checkpoint = runtimeCheckpoint(key, localId);
  if (!checkpoint) {
    // No Begin can have occurred (the checkpoint is always retained before
    // Begin): exact local cancellation, journal delete ordered, no waiting on
    // another row's network run.
    patchItem(key, localId, {
      status: "cancelled",
      cancelIntent: false,
      recoverable: false,
      errorText: "",
      ...ATTEMPT_FIELDS_CLEARED,
    });
    void requestRowDelete(scope, localId);
    return;
  }
  patchItem(key, localId, {
    status: "cancelling",
    cancelIntent: true,
    errorText: "",
    scheduled: false,
    transferPhase: undefined,
  });
  // Persist the cancel intent as soon as possible without delaying the RPC.
  scheduleAttachmentPersist(scope, localId);
  scheduler.enqueueControl(async () => {
    if (runtimeRemoved(key, localId)) return;
    if (runtimeGeneration(key, localId) !== generation) return; // a newer claim owns the row
    const port = await transferPort();
    if (runtimeGeneration(key, localId) !== generation) return;
    if (!session || !ownerStillValid(scope, session)) {
      retainUnresolvedCancel(key, localId, attachT("err.cancelPending"));
      return;
    }
    try {
      const state = await port.cancel(session, checkpoint);
      const current = findItem(key, localId);
      if (current && current.cancelIntent && runtimeGeneration(key, localId) === generation) {
        applyTerminalState(scope, key, localId, current, state);
      }
    } catch (error) {
      if (isAbortError(error)) return;
      if (isExpiredError(error)) { handleExpiredHandle(scope, key, localId); return; }
      // Unknown effect: one read-only status reconciliation, never a write.
      try {
        const state = await port.inspect(session, checkpoint);
        const current = findItem(key, localId);
        if (!current || !current.cancelIntent || runtimeGeneration(key, localId) !== generation) return;
        if (state.state === "committed" || state.state === "cancelled") {
          applyTerminalState(scope, key, localId, current, state);
        } else {
          retainUnresolvedCancel(key, localId, attachT("err.cancelUncertain", { message: messageOf(error) }));
        }
      } catch (inspectError) {
        if (isExpiredError(inspectError)) { handleExpiredHandle(scope, key, localId); return; }
        retainUnresolvedCancel(key, localId, attachT("err.cancelUncertain", { message: messageOf(inspectError) }));
      }
    }
  });
}

/** Read-only explicit status check. Never resumes, writes, or begins. */
export async function checkUpload(scope: AttachmentScope, localId: string): Promise<void> {
  const key = attachmentScopeKey(scope);
  const item = findItem(key, localId);
  const checkpoint = runtimeCheckpoint(key, localId);
  if (!item || !checkpoint) return;
  const generation = runtimeGeneration(key, localId);
  const session = liveSession();
  if (!scopeMatches(scope) || !session) {
    setQueueNotice(key, attachT("err.gate"));
    return;
  }
  scheduler.enqueueControl(async () => {
    if (runtimeRemoved(key, localId)) return;
    const port = await transferPort();
    // Revalidate scope/session and ownership after the import boundary.
    if (runtimeGeneration(key, localId) !== generation) return;
    if (!scopeMatches(scope) || liveSession() !== session) {
      setQueueNotice(key, attachT("err.gate"));
      return;
    }
    // Status timing measures ONLY the actual read-only inspect — never the
    // queue wait or the lazy port load. Publish the live status phase and
    // guard the generation once more as the inspect actually begins.
    const statusClock = createAttachmentStageClock();
    statusClock.begin("status");
    if (runtimeGeneration(key, localId) !== generation) {
      statusClock.end("status");
      return;
    }
    patchItem(key, localId, { transferPhase: "status" });
    // Close the status clock and fold the measured duration into the row's
    // stage timings while clearing ALL live attempt fields (incl. the phase).
    const priorStageTimings = item?.stageTimings;
    function settle(patch: Partial<AttachmentItem>): void {
      const ms = statusClock.end("status");
      const live = findItem(key, localId);
      const base = live?.stageTimings ?? priorStageTimings;
      const stageTimings: AttachmentItem["stageTimings"] = { ...(base ?? {}) };
      if (ms !== undefined) stageTimings.status = ms;
      patchItem(key, localId, { ...patch, ...ATTEMPT_FIELDS_CLEARED, stageTimings });
    }
    try {
      const state = await port.inspect(session, checkpoint);
      const current = findItem(key, localId);
      if (!current || runtimeGeneration(key, localId) !== generation) return;
      if (state.state === "uploading") {
        // Read-only: pending bytes exist but no transfer runs here. Stay
        // paused/actionable with the acknowledged offset — never auto-resumed.
        const acknowledged = Math.max(current.acknowledged, Math.min(state.offset, item.size));
        if (current.cancelIntent) {
          settle({
            status: "error",
            recoverable: false,
            cancelIntent: true,
            acknowledged,
            errorText: attachT("err.cancelUncertain", { message: attachT("err.cancelPending") }),
          });
        } else {
          settle({
            status: "error",
            recoverable: true,
            cancelIntent: false,
            acknowledged,
            errorText: "",
          });
        }
        return;
      }
      // Terminal settlement preserves stageTimings and clears attempt fields;
      // publish the measured status duration first so it carries through.
      const ms = statusClock.end("status");
      const live = findItem(key, localId);
      if (ms !== undefined && live) {
        patchItem(key, localId, { stageTimings: { ...(live.stageTimings ?? {}), status: ms } });
      }
      applyTerminalState(scope, key, localId, findItem(key, localId) ?? current, state);
    } catch (error) {
      const current = findItem(key, localId);
      if (!current || runtimeGeneration(key, localId) !== generation) return;
      if (isExpiredError(error)) {
        // Preserve the measured status duration through the expired-handle
        // settlement (which still clears the live phase/attempt fields).
        const ms = statusClock.end("status");
        if (ms !== undefined) {
          patchItem(key, localId, { stageTimings: { ...(current.stageTimings ?? {}), status: ms } });
        }
        handleExpiredHandle(scope, key, localId);
        return;
      }
      settle({
        status: "error",
        recoverable: current.cancelIntent ? false : current.recoverable,
        cancelIntent: current.cancelIntent,
        acknowledged: current.acknowledged,
        errorText: attachT(current.cancelIntent ? "err.cancelUncertain" : "err.statusFailed", { message: messageOf(error) }),
      });
    }
  });
}

/**
 * True while the row still holds a remote upload handle that must be
 * reconciled (resume/check/cancel) before a fresh Begin or removal.
 */
export function hasUploadHandle(scope: AttachmentScope, localId: string): boolean {
  return runtimeCheckpoint(attachmentScopeKey(scope), localId) !== null;
}

/** Explicit, user-initiated status read and continuation after a failure. */
export function resumeUpload(scope: AttachmentScope, localId: string): void {
  const key = attachmentScopeKey(scope);
  const item = findItem(key, localId);
  const file = runtimeFile(key, localId);
  const checkpoint = runtimeCheckpoint(key, localId);
  if (!item || !file || !checkpoint) return;
  if (isActiveStatus(item) || item.scheduled || item.cancelIntent) return;
  if (item.status !== "error" || !item.recoverable) return;
  const session = liveSession();
  if (!scopeMatches(scope) || !uploadFileEnabled() || !session) {
    setQueueNotice(key, attachT("err.gate"));
    return;
  }
  const generation = bumpRuntimeGeneration(key, localId);
  if (generation === null) return;
  setRuntimeAbort(key, localId, new AbortController());
  // Queued+scheduled until prepare; recoverable stays true for the attempt.
  patchItem(key, localId, {
    status: "queued",
    scheduled: true,
    transferPhase: "queued",
    errorText: "",
    recoverable: true,
    speedBps: undefined,
    etaSeconds: undefined,
    waiting: false,
  });
  // The transfer reads status FIRST and never replays begin.
  enqueueUploadJob(scope, localId, "resume", session, generation);
}

export async function removeItem(scope: AttachmentScope, localId: string): Promise<void> {
  const key = attachmentScopeKey(scope);
  const item = findItem(key, localId);
  if (!item) return;
  // Committed is terminal on the computer: removal drops the local row only.
  if (item.status === "committed") {
    void requestRowDelete(scope, localId);
    removeRow(key, localId);
    return;
  }
  // A retained checkpoint must be explicitly reconciled (cancel) before the
  // row can be dropped; the user removes again once it is settled.
  if (runtimeCheckpoint(key, localId)) {
    if (item.status !== "cancelling") cancelUpload(scope, localId);
    return;
  }
  // No remote handle: stop any scheduled/in-flight local attempt (no Begin can
  // have happened without a checkpoint), then drop the row and its record.
  if (item.scheduled || item.status === "preparing" || item.status === "uploading") {
    bumpRuntimeGeneration(key, localId);
    abortAttachment(key, localId);
  }
  void requestRowDelete(scope, localId);
  removeRow(key, localId);
}

// --- Image editing -----------------------------------------------------------------
export { editImage } from "./attachments-edit";

// --- Draft insertion ---------------------------------------------------------------
export { insertPaths } from "./attachments-insertion";
