/**
 * Serial thumbnail producer for attachment rows.
 *
 * Thumbnails share the core image queue with full compression (1 active +
 * 4 queued), and compression itself needs queue capacity, so the store never
 * fans thumbnail work out: an explicit one-job-at-a-time queue below lets at
 * most ONE thumbnail request enter the shared core, and waiting work lives in
 * a mutable node (never captured by the drain closure). A request aborted
 * while still queued is spliced out immediately — its (up to 40 MiB) source
 * File and callback closures are released at once, instead of lingering until
 * every earlier job settles. An already-aborted request is never enqueued.
 *
 * The ACTIVE job keeps owning its source until the abort-aware core settles:
 * a running prepare cannot be unwound, but the core receives the signal and
 * settles (AbortError) on cancel.
 *
 * This module deliberately does NOT import the store (the store imports this
 * one): every per-row decision is injected by the caller. `isCurrent` lets a
 * late answer verify the entry/source/thumbnail revision is still the one
 * that asked, and `publish` is the only way a result (including a null
 * failure) gets back to the row. The real lib preparer loads lazily on first
 * use; tests inject a fake through `setThumbnailPreparer`.
 */
import type { AttachmentThumbnailOptions } from "../../../lib/attachment-thumbnail";

export type ThumbnailPreparer = (
  file: File,
  options?: AttachmentThumbnailOptions,
) => Promise<Blob | null>;

/** One row's thumbnail request; all callbacks are store-provided. */
export type ThumbnailWork = {
  /** The exact source File revision to render (never the upload File). */
  source: File;
  /** This row revision's thumbnail-only abort signal. */
  signal: AbortSignal;
  /** Entry still exists and this request is still its latest revision. */
  isCurrent: () => boolean;
  /** Install Blob, or null when the row must keep its empty placeholder. */
  publish: (blob: Blob | null) => void;
};

/** Mutable queue node: abort clears work/onAbort so the File is released. */
type QueueNode = {
  work: ThumbnailWork | null;
  onAbort: (() => void) | null;
};

let injectedPreparer: ThumbnailPreparer | null = null;

/** Tests inject a fake preparer; production leaves this null for lazy load. */
export function setThumbnailPreparer(preparer: ThumbnailPreparer | null): ThumbnailPreparer | null {
  injectedPreparer = preparer;
  return preparer;
}

async function resolvePreparer(): Promise<ThumbnailPreparer> {
  if (injectedPreparer) return injectedPreparer;
  // Lazy import: the codec worker host loads only when a thumbnail is wanted;
  // a missing/broken lib never blocks adoption (the row keeps its placeholder).
  const mod = await import("../../../lib/attachment-thumbnail");
  return mod.prepareAttachmentThumbnail;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && (error as { name?: unknown }).name === "AbortError";
}

// Explicit tiny serial queue: `queued` holds only WAITING nodes; `running`
// marks the single active drain. The drain closes over `queued`/`running`,
// never over an individual request, so splicing an aborted node releases its
// source File and callbacks immediately.
const queued: QueueNode[] = [];
let running = false;

export function requestThumbnail(work: ThumbnailWork): void {
  if (work.signal.aborted) return; // already aborted: enqueue/retain nothing
  const node: QueueNode = { work, onAbort: null };
  const onAbort = (): void => {
    // Still waiting: remove the holder itself RIGHT NOW. The node keeps no
    // source File or row callbacks after this; an abort after the node was
    // shifted into the active slot finds nothing here (the active job settles
    // through its abort-aware core call).
    const index = queued.indexOf(node);
    if (index < 0) return;
    queued.splice(index, 1);
    node.work = null;
    node.onAbort = null;
  };
  node.onAbort = onAbort;
  work.signal.addEventListener("abort", onAbort, { once: true });
  queued.push(node);
  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const node = queued.shift();
      if (!node) break;
      const work = node.work;
      const onAbort = node.onAbort;
      node.work = null;
      node.onAbort = null;
      if (!work || !onAbort) continue; // aborted holder (splice normally removes it)
      // Off the queue: its queued-abort removal is a no-op from here on.
      work.signal.removeEventListener("abort", onAbort);
      if (work.signal.aborted) continue;
      // The ACTIVE job holds its source until this abort-aware call settles.
      await produceThumbnail(work);
    }
  } finally {
    running = false;
  }
}

async function produceThumbnail(work: ThumbnailWork): Promise<void> {
  let preparer: ThumbnailPreparer;
  try {
    preparer = await resolvePreparer();
  } catch {
    if (!work.signal.aborted && work.isCurrent()) work.publish(null);
    return;
  }
  // The lazy-import await is a cancellation/identity checkpoint.
  if (work.signal.aborted || !work.isCurrent()) return;
  let blob: Blob | null;
  try {
    blob = await preparer(work.source, { signal: work.signal });
  } catch (error) {
    // Abort takes precedence (edit/remove/reset): a superseded answer never
    // publishes. Any other failure with ownership intact keeps the placeholder.
    if (!work.signal.aborted && !isAbortError(error) && work.isCurrent()) work.publish(null);
    return;
  }
  // Revalidate after the core await; the store re-checks identity again too.
  if (work.signal.aborted || !work.isCurrent()) return;
  work.publish(blob);
}

/** Test-only inspection seam: waiting (not active) thumbnail nodes. */
export function __queuedThumbnailCount(): number {
  return queued.length;
}
