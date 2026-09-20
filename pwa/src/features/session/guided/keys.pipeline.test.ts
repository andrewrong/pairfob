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
const { dropQueuedKeys, queueKey } = await import("./keys.ts");
import type { LiveSession } from "../../../lib/protocol/session-types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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
