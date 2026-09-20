/**
 * Local attachment pick-readiness helper.
 *
 * Background: the product's `refreshHerdConfig` clears capabilities before it
 * awaits `GetConfig`, so during a native picker's focus-return the `upload_file`
 * grant can be briefly absent. `addPickedFiles` must not instantly drop the
 * just-selected files merely because that recovery overlaps the return focus.
 *
 * This is a SMALL, BOUNDED local helper only — no RPC, no connection
 * initiation, no capability grant. It merely waits for an existing
 * `upload_file` publication to land (the GetConfig recovery already in flight)
 * and resolves only when BOTH the owner is still current AND the live grant is
 * true. If the owner is no longer current, or the deadline passes, it fails
 * closed with false. It never rejects.
 *
 * The caller captures the exact live session at file-selection entry and
 * passes a scope+session identity guard via `isCurrent`; after the await the
 * caller rechecks the guard and rereads limits/queue. Nothing here performs an
 * automatic upload or Begin — it only awaits an existing publication.
 *
 * Timers and the subscriptions store listener are cleaned on EVERY resolve,
 * including a synchronous subscribe reentry; an older daemon's capability
 * simply reports false, so a permanent absence fails closed at the deadline.
 */
import { capabilityEnabled, capabilitiesStore } from "../../operations/capabilities-store";
import type { Unsubscribe } from "../../../shared/model/domain-store";

/** Fixed poll cadence so an abandoned pick (caps never change) still releases. */
const READINESS_POLL_MS = 100;

/**
 * Resolve when attachment picking is ready.
 *
 * @param isCurrent owner/scope/session identity guard captured at pick entry.
 * @param timeoutMs bounded wait (injectable for short tests).
 * @returns true only if the owner is still current AND `upload_file` is live;
 *   false if the owner is gone or the deadline expires. Never rejects.
 */
export function waitForAttachmentPickReadiness(
  isCurrent: () => boolean,
  timeoutMs = 5000,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unsubscribe: Unsubscribe | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    // The owner guard must never reject the promise; a throw fails closed.
    const currentSafe = (): boolean => {
      try {
        return isCurrent();
      } catch {
        return false;
      }
    };
    const grantNow = (): boolean => {
      try {
        return currentSafe() && capabilityEnabled("upload_file");
      } catch {
        return false;
      }
    };

    /** Settle exactly once; clean every timer and the subscription. */
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (unsubscribe !== undefined) {
        unsubscribe();
        unsubscribe = undefined;
      }
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      resolve(value);
    };

    const onCapabilities = (): void => {
      if (settled) return;
      // A live grant lands: resolve true now (owner + grant both required).
      // The owner leaving is resolved false right here rather than waiting for
      // the poll, so a lost session releases promptly on any publication.
      if (!currentSafe()) {
        finish(false);
      } else if (grantNow()) {
        finish(true);
      }
    };

    // Recheck BEFORE subscribing, so an already-published grant resolves
    // synchronously and an already-abandoned owner fails closed promptly.
    if (grantNow()) {
      finish(true);
      return;
    }
    if (!currentSafe()) {
      finish(false);
      return;
    }

    // Subscribe capturing the disposer into a local FIRST: the store may fire
    // the listener synchronously during subscribe (a reentry that settles
    // before `unsubscribe` is assigned). If it did, dispose that leaked
    // listener via the local and stop before creating any timers.
    const disposer = capabilitiesStore.subscribe(onCapabilities);
    if (settled) {
      disposer();
      return;
    }
    unsubscribe = disposer;

    // Recheck AFTER subscribing: a synchronous notification fired between the
    // pre-check and subscription (or a future publish) may already be live.
    if (grantNow()) {
      finish(true); // finish() unsubscribes via `unsubscribe`
      return;
    }

    // Poll the owner guard so an abandoned pick is released even when the
    // capabilities are never re-published.
    pollTimer = setInterval(() => {
      if (settled) return;
      if (!currentSafe()) {
        finish(false);
      }
    }, READINESS_POLL_MS);

    timeoutTimer = setTimeout(() => {
      finish(false); // deadline: fail closed to not-ready
    }, timeoutMs);
  });
}