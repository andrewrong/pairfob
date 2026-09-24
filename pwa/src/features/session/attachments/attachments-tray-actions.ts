/**
 * Tray actions (session page v2): picking and pasting straight into the tray,
 * automatic upload once a direct connection is up, quick removal with undo,
 * quality changes and "continue" for paused or failed rows.
 *
 * Everything here goes through the existing controller entry points
 * (startUpload / resumeUpload / checkUpload / cancelUpload / removeItem), so
 * the claim, checkpoint and recovery rules stay in one place. What this module
 * adds is tray-only state: rows hidden by a removal that can still be undone,
 * and which removals are waiting for a remote cancel to settle.
 */
import { attachT } from "./attach-copy";
import type { AttachmentItem, AttachmentScope } from "./attach-model";
import { attachmentP2PReady, attachmentsAllowed, currentAttachmentScope, scopeMatches } from "./attachments-context";
import { connectAttachmentP2P, subscribeAttachmentP2P } from "./attachments-connection";
import {
  addPickedFiles,
  cancelUpload,
  checkUpload,
  hasUploadHandle,
  removeItem,
  resumeUpload,
  startUpload,
} from "./attachments-controller";
import {
  attachmentScopeKey,
  attachmentsStore,
  clearRestored,
  publishedQueue,
  queueSnapshot,
  reissueAttachment,
  setQueueNotice,
  setUploadQuality,
} from "./attachments-store";

/** How long a removed thumbnail can be brought back. */
export const UNDO_REMOVE_MS = 4000;

type PendingUndo = {
  scope: AttachmentScope;
  localId: string;
  name: string;
  /** The removal also cancelled a running upload. */
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout>;
};

/** Hidden rows per scope key; hidden rows are out of the tray and out of the message. */
const hidden = new Map<string, Set<string>>();
let undo: PendingUndo | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function publish(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeTrayState(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Changes whenever the hidden set or the undo offer changes. */
export function trayStateRevision(): number {
  return revision;
}

export function isHidden(key: string, localId: string): boolean {
  return hidden.get(key)?.has(localId) ?? false;
}

/** The queue rows the tray shows, in path order. */
export function visibleItems(key: string): readonly AttachmentItem[] {
  const items = queueSnapshot(key)?.items ?? [];
  const gone = hidden.get(key);
  return gone?.size ? items.filter((item) => !gone.has(item.localId)) : items;
}

let visibleCache: { key: string; queue: unknown; revision: number; items: readonly AttachmentItem[] } | null = null;

/**
 * `visibleItems` with a stable identity while neither the queue nor the
 * hidden set changed, for useSyncExternalStore.
 */
export function visibleItemsSnapshot(key: string): readonly AttachmentItem[] {
  const queue = publishedQueue(key);
  if (visibleCache && visibleCache.key === key && visibleCache.queue === queue && visibleCache.revision === revision) {
    return visibleCache.items;
  }
  const gone = hidden.get(key);
  const all = queue?.items ?? [];
  const items = gone?.size ? all.filter((item) => !gone.has(item.localId)) : all;
  visibleCache = { key, queue, revision, items };
  return items;
}

export function pendingUndo(): { key: string; localId: string; name: string; cancelled: boolean } | null {
  return undo
    ? { key: attachmentScopeKey(undo.scope), localId: undo.localId, name: undo.name, cancelled: undo.cancelled }
    : null;
}

function hide(key: string, localId: string): void {
  const set = hidden.get(key) ?? new Set<string>();
  set.add(localId);
  hidden.set(key, set);
}

function unhide(key: string, localId: string): void {
  hidden.get(key)?.delete(localId);
}

function findRow(key: string, localId: string): AttachmentItem | null {
  return queueSnapshot(key)?.items.find((item) => item.localId === localId) ?? null;
}

// --- Final removal ---------------------------------------------------------------

/** Rows whose remote cancel must settle before the row can be dropped. */
const settling = new Map<string, AttachmentScope>();
let settleWatch: (() => void) | null = null;

function settleKey(scope: AttachmentScope, localId: string): string {
  return `${attachmentScopeKey(scope)}\n${localId}`;
}

/**
 * Drop a hidden row for good. A row holding a remote handle is cancelled
 * first (removeItem does that); it leaves the queue once the cancel settles.
 * An unresolved cancel stays hidden until the next reload restores it.
 */
function discard(scope: AttachmentScope, localId: string): void {
  const key = attachmentScopeKey(scope);
  void removeItem(scope, localId);
  if (!findRow(key, localId)) {
    unhide(key, localId);
    return;
  }
  settling.set(settleKey(scope, localId), scope);
  settleWatch ??= attachmentsStore.subscribe(sweepSettling);
}

function sweepSettling(): void {
  let changed = false;
  for (const [id, scope] of [...settling]) {
    const key = attachmentScopeKey(scope);
    const localId = id.slice(id.indexOf("\n") + 1);
    const row = findRow(key, localId);
    if (!row) {
      settling.delete(id);
      unhide(key, localId);
      changed = true;
      continue;
    }
    if (row.status === "cancelled" || (row.status !== "cancelling" && !hasUploadHandle(scope, localId))) {
      settling.delete(id);
      void removeItem(scope, localId);
      if (!findRow(key, localId)) {
        unhide(key, localId);
        changed = true;
      }
    }
  }
  if (!settling.size && settleWatch) {
    settleWatch();
    settleWatch = null;
  }
  if (changed) publish();
}

function finishUndo(): void {
  if (!undo) return;
  const { scope, localId, timer } = undo;
  clearTimeout(timer);
  undo = null;
  discard(scope, localId);
}

/**
 * Quick removal from the tray. The row disappears at once and any running
 * upload is cancelled at once; the row itself is dropped when the undo offer
 * expires (or the next removal replaces the offer).
 */
export function removeWithUndo(scope: AttachmentScope, localId: string): void {
  const key = attachmentScopeKey(scope);
  const row = findRow(key, localId);
  if (!row || isHidden(key, localId)) return;
  finishUndo();
  const running = row.status === "preparing" || row.status === "uploading" || row.scheduled === true;
  if (running) cancelUpload(scope, localId);
  hide(key, localId);
  undo = {
    scope,
    localId,
    name: row.name,
    cancelled: running,
    timer: setTimeout(() => {
      finishUndo();
      publish();
    }, UNDO_REMOVE_MS),
  };
  publish();
}

/** Bring the last removed row back where it was; a cancelled upload starts again. */
export function undoRemove(): void {
  if (!undo) return;
  const { scope, localId, timer } = undo;
  clearTimeout(timer);
  undo = null;
  const key = attachmentScopeKey(scope);
  unhide(key, localId);
  const row = findRow(key, localId);
  if (row?.status === "cancelled") {
    const fresh = reissueAttachment(key, localId);
    if (fresh) autoStartUploads(scope);
  }
  publish();
}

/** Remove rows without an undo offer (the send prompt's "不带它发送", "清除"). */
export function discardAttachments(scope: AttachmentScope, localIds: readonly string[]): void {
  const key = attachmentScopeKey(scope);
  for (const localId of localIds) {
    hide(key, localId);
    discard(scope, localId);
  }
  publish();
}

// --- Auto start --------------------------------------------------------------------

/**
 * Start every fresh queued row of `scope` when a direct connection is up.
 * Restored rows wait for the reader ("全部继续"); hidden rows never start.
 */
export function autoStartUploads(scope: AttachmentScope): void {
  if (!attachmentP2PReady() || !scopeMatches(scope) || !attachmentsAllowed()) return;
  const key = attachmentScopeKey(scope);
  for (const item of queueSnapshot(key)?.items ?? []) {
    if (item.status !== "queued" || item.scheduled || item.cancelIntent || item.restored) continue;
    if (isHidden(key, item.localId)) continue;
    startUpload(scope, item.localId);
  }
}

let watchers = 0;
let unwatch: (() => void) | null = null;
let sweepQueued = false;

/**
 * Runs one microtask after the change that triggered it, never inside it: a
 * compound step (reissue then set quality, reissue then adopt an edit) must
 * finish before a queued row can be claimed, or the claim would upload the
 * bytes the step was about to replace.
 */
function autoStartCurrent(): void {
  if (sweepQueued) return;
  sweepQueued = true;
  queueMicrotask(() => {
    sweepQueued = false;
    if (!unwatch) return;
    const scope = currentAttachmentScope();
    if (scope) autoStartUploads(scope);
  });
}

/**
 * Keep uploads moving while a tray is mounted: new picks, rows put back in
 * the queue by a quality change, and rows that waited for P2P all start on
 * the next connection or queue change. Reference counted per mounted tray.
 */
export function watchAutoStart(): () => void {
  watchers += 1;
  if (!unwatch) {
    const stops = [
      attachmentsStore.subscribe(autoStartCurrent),
      // Transport, session and capability changes alike can make P2P ready.
      subscribeAttachmentP2P(autoStartCurrent),
    ];
    unwatch = () => stops.forEach((stop) => stop());
  }
  autoStartCurrent();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    watchers -= 1;
    if (watchers === 0 && unwatch) {
      unwatch();
      unwatch = null;
    }
  };
}

// --- Picking and pasting -----------------------------------------------------------

/** Files from the picker or a paste: into the tray, then upload when possible. */
export async function acceptFiles(scope: AttachmentScope, files: ArrayLike<File>): Promise<void> {
  await addPickedFiles(scope, files);
  autoStartUploads(scope);
}

/** Paste into the compose field: true when the files were taken into the tray. */
export function acceptPasted(files: readonly File[]): boolean {
  const scope = currentAttachmentScope();
  if (!files.length || !scope || !attachmentsAllowed()) return false;
  void acceptFiles(scope, files);
  return true;
}

// --- Row actions -------------------------------------------------------------------

/**
 * Continue one paused or failed row: connect first when that is what it waits
 * for, then resume a recoverable upload or start a fresh one.
 */
export async function continueAttachment(scope: AttachmentScope, localId: string): Promise<void> {
  const key = attachmentScopeKey(scope);
  const row = findRow(key, localId);
  if (!row) return;
  if (row.restored) clearRestored(key, localId);
  if (!attachmentP2PReady() && !(await connectAttachmentP2P(scope))) {
    setQueueNotice(key, attachT("attach.p2pFailed"));
    return;
  }
  const current = findRow(key, localId);
  if (!current) return;
  if (current.status === "error" && current.cancelIntent) {
    void checkUpload(scope, localId);
    return;
  }
  if (current.status === "error" && current.recoverable) {
    resumeUpload(scope, localId);
    return;
  }
  if (current.status === "error" && hasUploadHandle(scope, localId)) {
    void checkUpload(scope, localId);
    return;
  }
  if (current.status === "cancelled") {
    const fresh = reissueAttachment(key, localId);
    if (fresh) startUpload(scope, fresh);
    return;
  }
  startUpload(scope, localId);
}

/** Every row that needs the reader: failed, paused, restored or waiting for P2P. */
export function blockedRowIds(key: string, p2pReady: boolean): string[] {
  return visibleItems(key).filter((item) => {
    if (item.status === "error" || item.status === "cancelled") return true;
    if (item.status !== "queued" || item.scheduled) return false;
    return item.restored || !p2pReady;
  }).map((item) => item.localId);
}

/** "全部继续" / "重试": continue every blocked row in tray order. */
export async function continueBlocked(scope: AttachmentScope): Promise<void> {
  const key = attachmentScopeKey(scope);
  const ids = blockedRowIds(key, attachmentP2PReady());
  if (!ids.length) return;
  for (const localId of ids) if (findRow(key, localId)?.restored) clearRestored(key, localId);
  if (!attachmentP2PReady() && !(await connectAttachmentP2P(scope))) {
    setQueueNotice(key, attachT("attach.p2pFailed"));
    return;
  }
  for (const localId of ids) await continueAttachment(scope, localId);
  autoStartUploads(scope);
}

/**
 * Change one image's quality. A finished upload is uploaded again under a new
 * id (the old file stays on the computer); a queued or failed row just
 * switches before it starts.
 */
export function changeQuality(scope: AttachmentScope, localId: string, quality: "smart" | "original"): void {
  const key = attachmentScopeKey(scope);
  const row = findRow(key, localId);
  if (!row || row.kind !== "image") return;
  const id = row.status === "committed" || row.status === "cancelled" ? reissueAttachment(key, localId) : localId;
  if (!id || !setUploadQuality(key, id, quality)) return;
  const current = findRow(key, id);
  if (current?.status === "error") startUpload(scope, id);
  autoStartUploads(scope);
}

/** Test/teardown helper: forget hidden rows and pending undo/settle work. */
export function resetTrayActions(): void {
  if (undo) clearTimeout(undo.timer);
  undo = null;
  hidden.clear();
  settling.clear();
  settleWatch?.();
  settleWatch = null;
  unwatch?.();
  unwatch = null;
  watchers = 0;
  publish();
}
