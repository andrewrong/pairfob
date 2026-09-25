/**
 * Native-pick adoption duty: review a file selection against the LOCAL intake
 * budget, re-read gates/queue after every await, dedup on File-object
 * identity, and adopt accepted files in one write.
 *
 * Local intake is distinct from the final network limits: JPEG candidates
 * (image/jpeg MIME or .jpg/.jpeg name) may be picked up to 40 MiB, every
 * other file caps at 20 MiB, the retained SOURCE batch must stay under 80
 * MiB and at most 5 files live in one pane. The 40 MiB-per-file allowance is
 * what lets a large photo be compressed below the 20 MiB network cap before
 * its upload; the 80 MiB number is local retained capacity, never the remote
 * upload batch limit (enforced separately at network start).
 *
 * Split from attachments-controller by duty; the controller re-exports
 * `addPickedFiles` so existing imports are unchanged.
 */
import { haptic } from "../../../lib/dom";
import { attachT } from "./attach-copy";
import {
  isJpegCandidate,
  LOCAL_INTAKE_LIMITS,
  reviewLocalIncoming,
  type LocalIntakeLimits,
} from "./attachments-admission";
import {
  scopeMatches,
  transferPort,
  uploadFileEnabled,
} from "./attachments-context";
import {
  metaFromFile,
  type AttachmentScope,
  type IncomingMeta,
  type IncomingRejection,
} from "./attach-model";
import {
  adoptIncoming,
  attachmentScopeKey,
  ensureAttachmentQueue,
  queueSnapshot,
  runtimeSourceFile,
  setQueueNotice,
} from "./attachments-store";
import { liveSession } from "../../computers/catalog-store";
import { waitForAttachmentPickReadiness } from "./attachments-pick-readiness";
import { registerAttachmentScope } from "./attachments-recovery";

function formatLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

/**
 * The visible line for the first rejection. A per-file rejection names the
 * cap that applied to THAT file: a JPEG candidate sees the 40 MiB local
 * allowance, everything else the 20 MiB cap. Names repeat across distinct
 * files, but same-named picks share an extension and therefore a cap, so the
 * first matching meta is enough.
 */
function rejectionLine(
  rejections: readonly IncomingRejection[],
  metas: readonly IncomingMeta[],
  limits: LocalIntakeLimits,
): string {
  if (!rejections.length) return "";
  const first = rejections[0];
  switch (first.code) {
    case "fileTooLarge": {
      const meta = metas.find((candidate) => candidate.name === first.name);
      const fileLimit = meta && isJpegCandidate(meta) ? limits.jpegFileBytes : limits.defaultFileBytes;
      return attachT("err.fileTooLarge", { name: first.name, limit: formatLimit(fileLimit) });
    }
    case "batchTooLarge":
      return attachT("err.batchTooLarge", { limit: formatLimit(limits.batchBytes) });
    case "tooManyFiles":
      return attachT("err.tooManyFiles", { limit: limits.maxFiles });
  }
}

/**
 * Review picked files against the LOCAL intake limits and the queue AS IT
 * STANDS when the port resolves (re-read after the await), then adopt
 * accepted files in one write. Dedup is File-object identity only: metadata
 * (name+size) cannot establish identity, so two distinct File objects with
 * the same name/size are both adopted, while a repeated File object — in this
 * selection or already held as a queued row's source — is skipped.
 */
const pickOrder = new Map<string, Promise<void>>();

export async function addPickedFiles(scope: AttachmentScope, files: ArrayLike<File>): Promise<IncomingRejection[]> {
  const key = attachmentScopeKey(scope);
  const picked = Array.from(files);
  if (!picked.length) return [];
  const session = liveSession();
  // Keep selections for one pane in the order the user made them. The port
  // lookup may resolve later for a newer selection, reversing who gets the
  // remaining local capacity unless admission is serialized.
  const previous = pickOrder.get(key);
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  pickOrder.set(key, turn);
  if (previous) await previous;
  try {
    return await adoptPickedFiles(scope, key, picked, session);
  } finally {
    release();
    if (pickOrder.get(key) === turn) pickOrder.delete(key);
  }
}

async function adoptPickedFiles(scope: AttachmentScope, key: string, picked: File[], session: ReturnType<typeof liveSession>): Promise<IncomingRejection[]> {
  // Warm/reuse the shared transfer port. Limits used HERE are the local
  // intake limits, not the port's network limits; awaiting the port also keeps
  // an async boundary before gates/queue are re-read (behavior preserved from
  // the controller extraction).
  await transferPort();
  // Capability recovery may briefly clear upload_file while the native picker
  // returns focus (GetConfig already in flight). Wait bounded for that grant
  // to land, but only for the SAME live session that owned the pick; then
  // re-check the gate before adopting.
  const ready = await waitForAttachmentPickReadiness(
    () => session !== null && scopeMatches(scope) && liveSession() === session,
  );
  if (!ready || !scopeMatches(scope) || !uploadFileEnabled() || liveSession() !== session) {
    ensureAttachmentQueue(key);
    setQueueNotice(key, attachT("err.gate"));
    return [];
  }
  // Identity dedup happens HERE, after the port/readiness awaits, by
  // re-reading the queue's current runtime source File references: a row that
  // landed while the picker returned focus participates in dedup.
  const known = new Set<File>();
  for (const row of queueSnapshot(key)?.items ?? []) {
    const source = runtimeSourceFile(key, row.localId);
    if (source) known.add(source);
  }
  const fresh: File[] = [];
  for (const file of picked) {
    if (known.has(file)) continue; // same object: this selection or an existing row
    known.add(file);
    fresh.push(file);
  }
  const metas = fresh.map(metaFromFile);
  const result = reviewLocalIncoming(metas, queueSnapshot(key)?.items ?? [], LOCAL_INTAKE_LIMITS);
  // Pair each accepted meta with the FIRST unconsumed matching File, so every
  // accepted entry adopts the correct distinct file exactly once.
  const acceptedFiles: File[] = [];
  const consumed = new Set<number>();
  for (const meta of result.accepted) {
    const index = fresh.findIndex((file, candidate) =>
      !consumed.has(candidate) && file.name === meta.name && file.size === meta.size);
    if (index >= 0) {
      consumed.add(index);
      acceptedFiles.push(fresh[index]);
    }
  }
  if (acceptedFiles.length) {
    // Subscribe for durable writes BEFORE the rows are published so the
    // adoption event schedules the first journal flush.
    registerAttachmentScope(scope);
    adoptIncoming(key, scope, acceptedFiles);
  }
  if (result.rejected.length || acceptedFiles.length) haptic(4);
  // A rejection with nothing adopted must still surface its reason: create the
  // queue if this pick produced only rejections, then set the visible notice.
  if (result.rejected.length) ensureAttachmentQueue(key);
  setQueueNotice(key, rejectionLine(result.rejected, metas, LOCAL_INTAKE_LIMITS));
  return [...result.rejected];
}
