import { Window } from "happy-dom";
import { afterEach, describe, expect, test } from "bun:test";

const happy = new Window({ url: "https://pairfob.com/pair", width: 390, height: 844 });
const g = globalThis as unknown as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "localStorage"] as const) {
  g[key] = (happy as unknown as Record<string, unknown>)[key];
}
g.performance = happy.performance;
happy.document.body.innerHTML = '<main id="app"></main>';

const { bindPaneRefresh } = await import("../../../features/connection/refresh-request.ts");
const { setScreen } = await import("../../../app/navigation-store.ts");
const { selectPane } = await import("../session-store.ts");
const { attachLiveSession } = await import("../../computers/catalog-store.ts");
const { clearModifiers, pressModifier, releaseModifier } = await import("../keypad/keypad.ts");
const { dropQueuedKeys, queueKey, flushKeys, sendPage } = await import("./keys.ts");
import type { LiveSession } from "../../../lib/protocol/session-types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => {
  clearModifiers();
  dropQueuedKeys();
  bindPaneRefresh(async () => null);
  attachLiveSession(null);
  selectPane("");
  setScreen("home");
});

describe("guided key latency", () => {
  test("sends the first key immediately and pipelines its ordered pane read", async () => {
    const mutation = deferred<unknown>();
    const order: string[] = [];
    setScreen("pane");
    selectPane("p1");
    attachLiveSession({
      isConnected: () => true,
      sendKeys: (_paneId: string, keys: string[]) => {
        order.push(`send:${keys.join(",")}`);
        return mutation.promise;
      },
    } as unknown as LiveSession);
    bindPaneRefresh(async (request) => {
      order.push(`read:${request?.postponeFallback === true}:${typeof request?.notBefore === "number"}`);
      return null;
    });

    queueKey("enter");
    expect(order).toEqual(["send:enter", "read:true:true"]);

    mutation.resolve(undefined);
    await mutation.promise;
  });
});

test("modified keys are atomic PTY writes ordered between ordinary key batches", async () => {
  const first = deferred<unknown>();
  const received: Array<[string, unknown]> = [];
  setScreen("pane"); selectPane("p1");
  attachLiveSession({
    isConnected: () => true,
    sendKeys: (_pane: string, keys: string[]) => { received.push(["keys", keys]); return received.length === 1 ? first.promise : Promise.resolve(); },
    sendText: async (_pane: string, text: string) => { received.push(["text", text]); },
  } as unknown as LiveSession);
  bindPaneRefresh(async () => null);
  queueKey("left");
  pressModifier("alt"); releaseModifier("alt"); queueKey("up");
  pressModifier("shift"); releaseModifier("shift"); queueKey("tab");
  queueKey("right");
  expect(received).toEqual([["keys", ["left"]]]);
  first.resolve(undefined);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(received).toEqual([["keys", ["left"]], ["text", "\x1b[1;3A\x1b[Z"], ["keys", ["right"]]]);
});

async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

for (const change of ["pane", "session"] as const) {
  test(`late failure after ${change} change preserves the new queue and its drain`, async () => {
    const old = deferred<void>();
    const current = deferred<void>();
    const received: Array<[string, string[]]> = [];
    let calls = 0;
    const sendKeys = (pane: string, keys: string[]) => {
      received.push([pane, keys]);
      calls++;
      return calls === 1 ? old.promise : calls === 2 ? current.promise : Promise.resolve();
    };
    const session = { isConnected: () => true, sendKeys } as unknown as LiveSession;
    setScreen("pane"); selectPane("p1"); attachLiveSession(session);
    bindPaneRefresh(async () => null);
    queueKey("left");
    const oldDrain = flushKeys();
    dropQueuedKeys();
    const pane = change === "pane" ? "p2" : "p1";
    selectPane(pane);
    if (change === "session") attachLiveSession({ isConnected: () => true, sendKeys } as unknown as LiveSession);
    queueKey("right");
    queueKey("down");
    expect(received).toEqual([["p1", ["left"]], [pane, ["right"]]]);
    old.reject(new Error("old request failed"));
    await oldDrain;
    let drained = false;
    const newDrain = flushKeys().then(() => { drained = true; });
    await settleMicrotasks();
    expect(drained).toBe(false);
    current.resolve();
    await newDrain;
    expect(received).toEqual([["p1", ["left"]], [pane, ["right"]], [pane, ["down"]]]);
  });
}

test("page input waits for all native and modified key batches", async () => {
  const first = deferred<void>();
  const modified = deferred<void>();
  const received: string[] = [];
  setScreen("pane"); selectPane("p1");
  attachLiveSession({
    isConnected: () => true,
    sendKeys: (_pane: string, keys: string[]) => {
      received.push(keys.join(","));
      return received.length === 1 ? first.promise : Promise.resolve();
    },
    sendText: (_pane: string, text: string) => {
      received.push(text);
      return text === "\x1b[1;3A" ? modified.promise : Promise.resolve();
    },
  } as unknown as LiveSession);
  bindPaneRefresh(async () => null);
  queueKey("left");
  pressModifier("alt"); releaseModifier("alt"); queueKey("up");
  queueKey("right");
  const page = sendPage("down");
  await settleMicrotasks();
  expect(received).toEqual(["left"]);
  first.resolve();
  await settleMicrotasks();
  expect(received).toEqual(["left", "\x1b[1;3A"]);
  modified.resolve();
  await page;
  expect(received).toEqual(["left", "\x1b[1;3A", "right", "\x1b[6~"]);
});

test("a synchronous transport error does not leave the next queue stuck", async () => {
  const received: string[][] = [];
  let attempts = 0;
  setScreen("pane"); selectPane("p1");
  attachLiveSession({
    isConnected: () => true,
    sendKeys: (_pane: string, keys: string[]) => {
      if (++attempts === 1) throw new Error("transport closed synchronously");
      received.push(keys);
      return Promise.resolve();
    },
  } as unknown as LiveSession);
  bindPaneRefresh(async () => null);
  queueKey("left");
  await settleMicrotasks();
  queueKey("right");
  await flushKeys();
  expect(attempts).toBe(2);
  expect(received).toEqual([["right"]]);
});
