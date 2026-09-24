import { useSyncExternalStore } from "react";

/**
 * Per-device reading preferences for the inspector. Storage can be missing or
 * throw (private mode, blocked site data); the default then simply applies.
 */
const WRAP_KEY = "pairfob.workspace.wrap";
const listeners = new Set<() => void>();

function readWrap(): boolean {
  try { return globalThis.localStorage?.getItem(WRAP_KEY) === "1"; } catch { return false; }
}

let wrap = readWrap();

export function workspaceWrap(): boolean {
  return wrap;
}

export function setWorkspaceWrap(next: boolean): void {
  wrap = next;
  try { globalThis.localStorage?.setItem(WRAP_KEY, next ? "1" : "0"); } catch { /* keep the in-memory value */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWorkspaceWrap(): boolean {
  return useSyncExternalStore(subscribe, workspaceWrap, workspaceWrap);
}
