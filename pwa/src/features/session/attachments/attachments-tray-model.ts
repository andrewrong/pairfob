/**
 * Pure tray model (session page v2): what each attachment looks like on its
 * thumbnail, which actions its action bar offers, and what the send path sees.
 * No DOM, no stores; the tray, the send contract and their tests read the same
 * rules from here.
 */
import { progressPercent, safeCommittedPath, type AttachmentItem } from "./attach-model";

/**
 * One visual state per thumbnail. `processing` covers every step that runs
 * without the reader (queued behind another file, compressing, hashing,
 * cancelling); `waiting` needs a direct connection; `paused` needs the reader
 * to continue; `failed` needs a retry or a status check.
 */
export type TrayPhase = "processing" | "uploading" | "ready" | "waiting" | "paused" | "failed";

export type TrayContext = {
  /** A direct connection is up, so queued rows are about to start on their own. */
  p2pReady: boolean;
  /** The current draft text; an in-body path counts only while it is still there. */
  draft: string;
};

/** True while this row's committed path is written in the draft. */
export function inBody(item: AttachmentItem, draft: string): boolean {
  return item.status === "committed" && item.inserted && item.path !== "" && draft.includes(item.path);
}

export function trayPhase(item: AttachmentItem, ctx: TrayContext): TrayPhase {
  switch (item.status) {
    case "committed": return "ready";
    case "uploading": return "uploading";
    case "preparing":
    case "cancelling": return "processing";
    case "cancelled": return "failed";
    case "error":
      if (item.cancelIntent) return "failed";
      return item.recoverable ? "paused" : "failed";
    case "queued":
      if (item.scheduled) return "processing";
      // A restored row never starts by itself: the reader continues it.
      if (item.restored) return "paused";
      // Otherwise it starts as soon as the direct connection is up.
      return ctx.p2pReady ? "processing" : "waiting";
  }
}

/** Upload progress drawn on the ring, 0–100. */
export function trayPercent(item: AttachmentItem): number {
  return item.status === "committed" ? 100 : progressPercent(item);
}

export type TrayAction =
  | "connect"
  | "resume"
  | "retry"
  | "check"
  | "preview"
  | "toBody"
  | "fromBody"
  | "toOriginal"
  | "toSmart"
  | "remove";

export type TrayActionFacts = {
  /** The row still holds a remote upload handle that must be reconciled first. */
  hasHandle: boolean;
};

/** Original bytes: the explicit mode, or the retired "text & detail" intent. */
export function keepsOriginal(item: AttachmentItem): boolean {
  return (item.compressionMode ?? "smart") === "original" || item.imageIntent === "detail";
}

/**
 * The action bar lists only what can happen right now, most useful first.
 * Quality and in-body changes are offered on settled rows only: a running
 * upload finishes (or is removed) before its bytes change, and a path already
 * written in the draft would go stale if the file were uploaded again.
 */
export function trayActions(item: AttachmentItem, ctx: TrayContext, facts: TrayActionFacts): TrayAction[] {
  const phase = trayPhase(item, ctx);
  const actions: TrayAction[] = [];
  if (phase === "waiting") actions.push("connect");
  // Continuing connects first when it has to; the reader asks once.
  if (phase === "paused") actions.push("resume");
  if (phase === "failed") {
    if (item.cancelIntent || (facts.hasHandle && !item.recoverable)) actions.push("check");
    else actions.push("retry");
  }
  actions.push("preview");
  const body = inBody(item, ctx.draft);
  if (phase === "ready" && safeCommittedPath(item.path)) actions.push(body ? "fromBody" : "toBody");
  const settled = phase === "ready" || (phase === "failed" && !facts.hasHandle && !item.cancelIntent)
    || (item.status === "queued" && !item.scheduled && !facts.hasHandle);
  if (item.kind === "image" && settled && !body) actions.push(keepsOriginal(item) ? "toSmart" : "toOriginal");
  actions.push("remove");
  return actions;
}

/** Send-path view of the tray; the contract type lives in attachments-send.ts. */
export type SendSummary = {
  readyPaths: string[];
  pending: number;
  pendingPercent: number;
  blocked: number;
  blockedNames: string[];
  waitingP2P: boolean;
  total: number;
};

/**
 * Split the visible tray for the send button. Ready rows contribute their path
 * (tray order) unless the path already sits in the draft; rows that finish on
 * their own count as pending; rows that need the reader count as blocked.
 */
export function summarizeForSend(items: readonly AttachmentItem[], ctx: TrayContext): SendSummary {
  const readyPaths: string[] = [];
  const pendingPercents: number[] = [];
  const blockedNames: string[] = [];
  let waitingOnly = true;
  for (const item of items) {
    const phase = trayPhase(item, ctx);
    if (phase === "ready") {
      if (safeCommittedPath(item.path) && !inBody(item, ctx.draft)) readyPaths.push(item.path);
      continue;
    }
    if (phase === "processing" || phase === "uploading") {
      pendingPercents.push(trayPercent(item));
      continue;
    }
    blockedNames.push(item.name);
    if (phase !== "waiting") waitingOnly = false;
  }
  const pendingPercent = pendingPercents.length
    ? Math.floor(pendingPercents.reduce((total, value) => total + value, 0) / pendingPercents.length)
    : 100;
  return {
    readyPaths,
    pending: pendingPercents.length,
    pendingPercent,
    blocked: blockedNames.length,
    blockedNames,
    waitingP2P: blockedNames.length > 0 && waitingOnly,
    total: items.length,
  };
}
