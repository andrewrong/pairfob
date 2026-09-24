import { openPaneId } from "../session-store";

/**
 * Attachments ride with the message (session page v2): the gate between a send
 * tap and the surface's own submit. Uploads still running make the button wait
 * and send by itself when they finish; items that cannot finish on their own
 * (failed, paused, waiting for a direct connection) stop to ask instead of
 * silently going without them.
 *
 * One pending send at a time, owned by the pane it was requested on: a pane
 * switch drops it rather than delivering the old message into the new pane.
 *
 * The attachments contract arrives through a port connected by the compose
 * chrome: the attachments feature itself inserts into the compose controller
 * ("放进正文"), so a static import from this side would close a module cycle.
 */
/** The part of the attachments send state the gate reads (see attachments-send). */
export type GateAttachments = Readonly<{ readyPaths: readonly string[]; pending: number; blocked: number }>;

export type SendAttachmentsPort = {
  state: () => GateAttachments;
  subscribe: (listener: () => void) => () => void;
  markSent: () => void;
  retryBlocked: () => void;
  dropBlocked: () => void;
  acceptPaste: (files: readonly File[]) => boolean;
};

const NO_ATTACHMENTS: GateAttachments = { readyPaths: [], pending: 0, blocked: 0 };

let port: SendAttachmentsPort = {
  state: () => NO_ATTACHMENTS,
  subscribe: () => () => undefined,
  markSent: () => undefined,
  retryBlocked: () => undefined,
  dropBlocked: () => undefined,
  acceptPaste: () => false,
};

export function connectSendAttachments(next: SendAttachmentsPort): void {
  port = next;
}

/** After the message carrying the ready paths reached the terminal. */
export function markSentAttachments(): void {
  port.markSent();
}

/** Pasted files go to the attachment tray instead of the draft. */
export function acceptComposePaste(event: ClipboardEvent): void {
  const files = event.clipboardData?.files;
  if (!files?.length) return;
  if (port.acceptPaste([...files])) event.preventDefault();
}

export type SendRun = (paths: readonly string[]) => void | Promise<void>;

export type SendGateSnapshot = Readonly<{
  /** Waiting for uploads; the next tap cancels. */
  waiting: boolean;
  /** Blocked items need a choice before sending. */
  issue: boolean;
}>;

type Pending = { paneId: string; run: SendRun };

let waiting: Pending | null = null;
let issue: Pending | null = null;
let unsubscribeUploads: (() => void) | null = null;
let snap: SendGateSnapshot = { waiting: false, issue: false };
const listeners = new Set<() => void>();

function publish(): void {
  const next = { waiting: waiting !== null, issue: issue !== null };
  if (next.waiting === snap.waiting && next.issue === snap.issue) return;
  snap = next;
  for (const listener of listeners) listener();
}

export function sendGateSnapshot(): SendGateSnapshot {
  return snap;
}

export function subscribeSendGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Message = draft, a blank line, then one attachment path per line (tray order). */
export function attachmentMessage(draft: string, paths: readonly string[]): string {
  if (!paths.length) return draft;
  const body = draft.trim() ? draft.replace(/\s+$/, "") : "";
  return body + (body ? "\n\n" : "") + paths.join("\n");
}

function stopWatchingUploads(): void {
  unsubscribeUploads?.();
  unsubscribeUploads = null;
}

function uploadsSettled(): void {
  const pending = waiting;
  if (!pending) return;
  if (port.state().pending > 0) return;
  waiting = null;
  stopWatchingUploads();
  publish();
  if (pending.paneId !== openPaneId()) return;
  void requestSend(pending.run);
}

/**
 * Send now, wait for uploads, or ask about blocked items. Returns the run's
 * promise when it ran immediately.
 */
export function requestSend(run: SendRun, state: GateAttachments = port.state()): void | Promise<void> {
  const paneId = openPaneId();
  issue = null;
  if (state.pending > 0) {
    waiting = { paneId, run };
    unsubscribeUploads ??= port.subscribe(uploadsSettled);
    publish();
    return;
  }
  if (state.blocked > 0) {
    issue = { paneId, run };
    publish();
    return;
  }
  publish();
  return run(state.readyPaths);
}

export function cancelSendWait(): void {
  waiting = null;
  stopWatchingUploads();
  publish();
}

export function dismissSendIssue(): void {
  issue = null;
  publish();
}

/** 重试 / 连接: the items resume; the reader sends again once they are ready. */
export function retrySendIssue(): void {
  issue = null;
  publish();
  port.retryBlocked();
}

/** 不带它发送: drop the blocked items and send the rest. */
export function sendWithoutBlocked(): void | Promise<void> {
  const pending = issue;
  issue = null;
  publish();
  if (!pending || pending.paneId !== openPaneId()) return;
  port.dropBlocked();
  return pending.run(port.state().readyPaths);
}

/** The dock unmounted or the pane changed: nothing pending may fire later. */
export function resetSendGate(): void {
  waiting = null;
  issue = null;
  stopWatchingUploads();
  publish();
}
