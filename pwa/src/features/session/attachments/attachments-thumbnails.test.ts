import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __queuedThumbnailCount,
  requestThumbnail,
  setThumbnailPreparer,
  type ThumbnailPreparer,
  type ThumbnailWork,
} from "./attachments-thumbnails";

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

function tinyBlob(type = "image/jpeg"): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])], { type });
}

function fakeFile(name: string, size: number, type = "image/jpeg"): File {
  return new File([new Uint8Array(size)], name, { type });
}

type Gate = { promise: Promise<Blob | null>; resolve: (blob: Blob | null) => void; reject: (error: unknown) => void };

function gate(): Gate {
  let resolve!: (blob: Blob | null) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Blob | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let the serial queue's microtask chain run to a settled state. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type FakeCall = {
  file: File;
  signal: AbortSignal;
  gate: Gate;
};

/**
 * Preparer fake that records every invocation and parks each call on a gate,
 * so tests control active vs queued work exactly. It mirrors the real core
 * contract: an abort listener rejects the call with AbortError.
 */
function gatedPreparer(): { calls: FakeCall[]; preparer: ThumbnailPreparer } {
  const calls: FakeCall[] = [];
  const preparer: ThumbnailPreparer = (file, options) => {
    const callGate = gate();
    const record: FakeCall = { file, signal: options!.signal!, gate: callGate };
    options?.signal?.addEventListener(
      "abort",
      () => callGate.reject(abortError()),
      { once: true },
    );
    calls.push(record);
    return callGate.promise;
  };
  return { calls, preparer };
}

function work(
  source: File,
  publish: (blob: Blob | null) => void,
  overrides?: { signal?: AbortSignal; isCurrent?: () => boolean },
): { work: ThumbnailWork; controller: AbortController } {
  const controller = new AbortController();
  return {
    controller,
    work: {
      source,
      signal: overrides?.signal ?? controller.signal,
      isCurrent: overrides?.isCurrent ?? (() => true),
      publish,
    },
  };
}

beforeEach(() => {
  setThumbnailPreparer(null);
});

afterEach(() => {
  setThumbnailPreparer(null);
});

describe("serial thumbnail queue", () => {
  test("at most one preparer call is active; queued work drains in order", async () => {
    const { calls, preparer } = gatedPreparer();
    setThumbnailPreparer(preparer);
    const published: string[] = [];
    const a = work(fakeFile("a.jpg", 10), () => published.push("a"));
    const b = work(fakeFile("b.jpg", 20), () => published.push("b"));
    const c = work(fakeFile("c.jpg", 30), () => published.push("c"));

    requestThumbnail(a.work);
    await flush();
    expect(calls).toHaveLength(1); // a is the single active job
    requestThumbnail(b.work);
    requestThumbnail(c.work);
    await flush();
    expect(calls).toHaveLength(1); // b and c wait; no second concurrent producer
    expect(__queuedThumbnailCount()).toBe(2);

    calls[0].gate.resolve(tinyBlob());
    await flush();
    expect(calls.map((call) => call.file.name)).toEqual(["a.jpg", "b.jpg"]);
    calls[1].gate.resolve(tinyBlob());
    await flush();
    expect(calls.map((call) => call.file.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    calls[2].gate.resolve(tinyBlob());
    await flush();
    expect(published).toEqual(["a", "b", "c"]);
    expect(__queuedThumbnailCount()).toBe(0);
  });

  test("a queued abort removes the holder immediately, allocates nothing, and later work still drains", async () => {
    const { calls, preparer } = gatedPreparer();
    setThumbnailPreparer(preparer);
    const published: string[] = [];

    const active = work(fakeFile("active.jpg", 10), () => published.push("active"));
    requestThumbnail(active.work);
    await flush();
    expect(calls).toHaveLength(1); // active owns the single producer slot

    // A 40 MiB-class source waits behind it, then is cancelled while queued.
    const bigSource = fakeFile("queued-big.jpg", 40 * 1024 * 1024);
    const queued = work(bigSource, () => published.push("queued"));
    requestThumbnail(queued.work);
    await flush();
    expect(__queuedThumbnailCount()).toBe(1);
    expect(calls).toHaveLength(1); // no worker allocation for the queued item

    queued.controller.abort();
    expect(__queuedThumbnailCount()).toBe(0); // holder gone the instant it aborts
    expect(calls).toHaveLength(1); // still nothing allocated for it
    // New work enqueued after the cancel must still drain normally.
    const next = work(fakeFile("next.jpg", 5), () => published.push("next"));
    requestThumbnail(next.work);
    expect(__queuedThumbnailCount()).toBe(1);

    calls[0].gate.resolve(tinyBlob());
    await flush();
    // The aborted request never reached the preparer; the new one did.
    expect(calls.map((call) => call.file.name)).toEqual(["active.jpg", "next.jpg"]);
    calls[1].gate.resolve(tinyBlob());
    await flush();
    expect(published).toEqual(["active", "next"]); // the cancelled row published nothing
  });

  test("an already-aborted request is not enqueued and retains nothing", () => {
    const { preparer } = gatedPreparer();
    setThumbnailPreparer(preparer);
    const controller = new AbortController();
    controller.abort();
    let published = false;
    const { work: dead } = work(fakeFile("dead.jpg", 999), () => { published = true; }, {
      signal: controller.signal,
    });
    requestThumbnail(dead);
    expect(__queuedThumbnailCount()).toBe(0);
    expect(published).toBe(false);
  });

  test("aborting the ACTIVE job settles through the abort-aware core and publishes nothing", async () => {
    const { calls, preparer } = gatedPreparer();
    setThumbnailPreparer(preparer);
    let published: Blob | null | undefined;
    const active = work(fakeFile("active.jpg", 10), (blob) => { published = blob; });
    requestThumbnail(active.work);
    await flush();
    active.controller.abort(); // core rejects with AbortError
    await flush();
    expect(published).toBeUndefined();
    // The slot released: a following job runs.
    const follower = work(fakeFile("follower.jpg", 3), () => { published = "done" as never; });
    requestThumbnail(follower.work);
    await flush();
    calls[1].gate.resolve(tinyBlob());
    await flush();
    expect(published).toBe("done");
  });
});

describe("thumbnail settlement", () => {
  test("a null result publishes null (placeholder), not the source", async () => {
    setThumbnailPreparer(async () => null);
    let published: Blob | null | undefined;
    const w = work(fakeFile("a.png", 10), (blob) => { published = blob; });
    requestThumbnail(w.work);
    await flush();
    expect(published).toBeNull();
  });

  test("a non-abort preparer failure publishes null while current", async () => {
    setThumbnailPreparer(async () => {
      throw new Error("codec exploded");
    });
    let published: Blob | null | undefined;
    const w = work(fakeFile("a.png", 10), (blob) => { published = blob; });
    requestThumbnail(w.work);
    await flush();
    expect(published).toBeNull();
  });

  test("a late answer whose isCurrent flipped false never publishes", async () => {
    const { calls, preparer } = gatedPreparer();
    setThumbnailPreparer(preparer);
    let published = false;
    const w = work(fakeFile("a.png", 10), () => { published = true; }, {
      isCurrent: () => current,
    });
    let current = true;
    requestThumbnail(w.work);
    await flush();
    current = false; // row edited/removed/re-adopted while the core ran
    calls[0].gate.resolve(tinyBlob("image/png"));
    await flush();
    expect(published).toBe(false);
  });

  test("an abort rejection never publishes even when isCurrent stays true", async () => {
    const { calls, preparer } = gatedPreparer();
    setThumbnailPreparer(preparer);
    let published: Blob | null | undefined;
    const w = work(fakeFile("a.png", 10), (blob) => { published = blob; });
    requestThumbnail(w.work);
    await flush();
    w.controller.abort();
    await flush();
    expect(calls).toHaveLength(1);
    expect(published).toBeUndefined();
  });

  test("a broken lazy preparer module publishes null", async () => {
    setThumbnailPreparer((): Promise<Blob | null> => Promise.reject(new Error("import failed")));
    let published: Blob | null | undefined;
    const w = work(fakeFile("a.png", 10), (blob) => { published = blob; });
    requestThumbnail(w.work);
    await flush();
    expect(published).toBeNull();
  });
});
