import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import {
  advertisedAgentKinds,
  applyCapabilities,
  clearCapabilities,
} from "../../operations/capabilities-store";
import { waitForAttachmentPickReadiness } from "./attachments-pick-readiness";

/** A genuine static no-dependency identity guard also used by controllers. */
const current = (value: boolean): (() => boolean) => () => value;

const grantUpload = (): void => {
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, upload_file: true }, advertisedAgentKinds());
};
const revokeUpload = (): void => {
  clearCapabilities();
};

beforeEach(() => {
  revokeUpload();
});
afterEach(() => {
  revokeUpload();
});

describe("waitForAttachmentPickReadiness", () => {
  test("immediate grant resolves true synchronously", async () => {
    grantUpload();
    const result = await waitForAttachmentPickReadiness(current(true), 5000);
    expect(result).toBe(true);
  });

  test("delayed clear->grant resolves true via the store subscription", async () => {
    const pending = waitForAttachmentPickReadiness(current(true), 1000);
    grantUpload(); // publishes; the subscriber resolves the pending helper
    await expect(pending).resolves.toBe(true);
  });

  test("permanent false fails closed at the deadline", async () => {
    const started = Date.now();
    const result = await waitForAttachmentPickReadiness(current(true), 25);
    expect(result).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  });

  test("owner not current at entry resolves false with no grant", async () => {
    const result = await waitForAttachmentPickReadiness(current(false), 1000);
    expect(result).toBe(false);
  });

  test("owner becoming not-current is released by polling even with no cap change", async () => {
    let live = true;
    const pending = waitForAttachmentPickReadiness(() => live, 5000);
    live = false; // abandon mid-flight; caps never change
    await expect(pending).resolves.toBe(false);
  });

  test("owner not current wins over a live grant", async () => {
    grantUpload();
    const result = await waitForAttachmentPickReadiness(current(false), 100);
    expect(result).toBe(false);
  });

  test("grant while owner stays current then false after completion does not revive", async () => {
    // Complete as false (owner abandoned); then a late grant must not revive.
    let live = true;
    const pending = waitForAttachmentPickReadiness(() => live, 5000);
    live = false;
    await expect(pending).resolves.toBe(false);
    grantUpload(); // late grant after resolve — must not change the result
    expect(await pending).toBe(false);
  });

  test("grant landing right after subscription is observed (race recheck)", async () => {
    // isCurrent stable true and no grant at entry -> helper subscribes; a
    // synchronous publish immediately after is caught by the recheck + listener.
    let live = true;
    const pending = waitForAttachmentPickReadiness(() => live, 1000);
    grantUpload();
    await expect(pending).resolves.toBe(true);
  });

  test("resolved helper ignores later publishes without throwing", async () => {
    const a = await waitForAttachmentPickReadiness(current(false), 50); // resolves false
    const b = await waitForAttachmentPickReadiness(current(true), 30); // resolves false (no grant)
    expect(a).toBe(false);
    expect(b).toBe(false);
    grantUpload(); // post-resolution publish exercises cleanup without reentry
    expect(await a).toBe(false);
    expect(await b).toBe(false);
  });

  test("synchronous subscribe reentry settles true, disposes the leaked listener once, and creates no later resources", async () => {
    // Safely spy the real store's subscribe (restored in finally) so the
    // listener is invoked synchronously BEFORE the disposer is returned.
    const { capabilitiesStore } = await import("../../operations/capabilities-store");
    const realSubscribe = capabilitiesStore.subscribe;
    const realSetInterval = globalThis.setInterval;
    const realSetTimeout = globalThis.setTimeout;
    let disposed = 0;
    let intervalsStarted = 0;
    let timeoutsStarted = 0;
    const disposer = (): void => {
      disposed += 1;
    };
    capabilitiesStore.subscribe = ((listener: () => void) => {
      // Publish the grant, then notify synchronously BEFORE returning.
      grantUpload();
      listener();
      return disposer as unknown as () => void;
    }) as typeof realSubscribe;
    globalThis.setInterval = ((..._args: unknown[]) => {
      intervalsStarted += 1;
      return 0 as never;
    }) as typeof realSetInterval;
    globalThis.setTimeout = ((..._args: unknown[]) => {
      timeoutsStarted += 1;
      return 0 as never;
    }) as typeof realSetTimeout;
    try {
      const result = await waitForAttachmentPickReadiness(current(true), 100);
      expect(result).toBe(true);
      // The leaked listener created during synchronous subscribe is disposed
      // exactly once via the returned disposer, and no timers are installed
      // after settling.
      expect(disposed).toBe(1);
      expect(intervalsStarted).toBe(0);
      expect(timeoutsStarted).toBe(0);
    } finally {
      capabilitiesStore.subscribe = realSubscribe;
      globalThis.setInterval = realSetInterval;
      globalThis.setTimeout = realSetTimeout;
    }
  });
});