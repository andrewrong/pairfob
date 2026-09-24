import { afterEach, beforeEach, expect, test } from "bun:test";
import { SessionSocket, socketPair } from "./session-socket-fixture";
import { sessionOverWS } from "../src/lib/protocol/session-ws";
import type { LiveSession } from "../src/lib/protocol/session-types";

let original: typeof WebSocket;
let live: LiveSession | undefined;
beforeEach(() => {
  original = globalThis.WebSocket;
  SessionSocket.instances = []; SessionSocket.hold = "none";
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: SessionSocket });
});
afterEach(() => {
  live?.close(); live = undefined;
  for (const socket of SessionSocket.instances) socket.finishClose();
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: original });
});
async function until(ready: () => boolean) {
  const end = Date.now() + 2000;
  while (!ready() && Date.now() < end) await Bun.sleep(1);
  expect(ready()).toBe(true);
}
async function interrupted() {
  live = await sessionOverWS("wss://pairfob.test/v2/ws", socketPair, { networkMode: "relay" });
  const events: string[] = [];
  live.onEvent(event => { if (event.type === "reconnecting") events.push(event.message ?? ""); });
  SessionSocket.hold = "bound";
  SessionSocket.instances[0]!.finishClose();
  await until(() => SessionSocket.instances[1]?.blocked === "bound");
  return { live, stale: SessionSocket.instances[1]!, events };
}

test("offline then online during a dial immediately starts exactly one fresh authenticated connection", async () => {
  const f = await interrupted();
  await expect(f.live.sendText("w1:p1", "do not replay")).rejects.toMatchObject({ code: "disconnected" });
  f.live.setNetworkAvailable?.(false);
  SessionSocket.hold = "none";
  f.live.setNetworkAvailable?.(true);
  for (let i = 0; i < 5; i++) f.live.reconnectNow("path");
  await until(() => f.live.isConnected());
  expect(SessionSocket.instances).toHaveLength(3);
  expect(f.events).toEqual(["正在重新连接", "正在重新连接"]);
  const count = f.stale.frames.length;
  f.stale.releaseLate(); f.stale.finishClose(); await Bun.sleep(20);
  expect(f.stale.frames).toHaveLength(count);
  expect(f.live.isConnected()).toBe(true);
  expect(SessionSocket.instances).toHaveLength(3);
  expect(SessionSocket.instances.flatMap(s => s.operations).every(op => op === "Ping")).toBe(true);
});

test("new hints do not replace a dial that succeeds", async () => {
  const f = await interrupted();
  for (let i = 0; i < 5; i++) f.live.reconnectNow("path");
  f.stale.releaseLate();
  await until(() => f.live.isConnected());
  await Bun.sleep(20);
  expect(SessionSocket.instances).toHaveLength(2);
  expect(f.events).toEqual(["正在重新连接"]);
});

for (const action of ["offline", "close"] as const) {
  test(`a retained wakeup cannot reconnect after ${action}`, async () => {
    const f = await interrupted();
    f.live.reconnectNow("path");
    if (action === "offline") f.live.setNetworkAvailable?.(false); else f.live.close();
    await Bun.sleep(20);
    expect(SessionSocket.instances).toHaveLength(2);
    expect(f.live.isConnected()).toBe(false);
  });
}

test("an ordinary failed dial still backs off without a newer wakeup", async () => {
  const f = await interrupted();
  f.stale.finishClose();
  await until(() => f.events.length === 2);
  expect(f.events[1]).toContain("秒后重连");
  expect(SessionSocket.instances).toHaveLength(2);
});

test("credential revocation wins over a retained wakeup", async () => {
  const f = await interrupted();
  const terminal: string[] = [];
  f.live.onEvent(event => { if (event.type === "terminal") terminal.push(event.code ?? ""); });
  f.live.reconnectNow("path");
  f.stale.reject("revoked");
  await until(() => terminal.length > 0);
  await Bun.sleep(20);
  expect(terminal).toEqual(["revoked"]);
  expect(SessionSocket.instances).toHaveLength(2);
  expect(f.live.isConnected()).toBe(false);
});

for (const action of ["offline", "close"] as const) {
  test(`a reconnect notification that reenters ${action} cannot start a queued dial`, async () => {
    live = await sessionOverWS("wss://pairfob.test/v2/ws", socketPair, { networkMode: "relay" });
    live.onEvent(event => {
      if (event.type === "reconnecting") {
        if (action === "offline") live!.setNetworkAvailable?.(false); else live!.close();
      }
    });
    SessionSocket.instances[0]!.finishClose();
    await Bun.sleep(20);
    expect(SessionSocket.instances).toHaveLength(1);
    expect(live.isConnected()).toBe(false);
  });
}

test("a dial surviving hidden and visible is attributed to the new foreground recovery", async () => {
  const { Window } = await import("happy-dom");
  const { connectionDiagnostics } = await import("../src/lib/protocol/connection-diagnostics");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const realm = new Window();
  let visibility = "visible";
  Object.defineProperty(realm.document, "visibilityState", { get: () => visibility });
  Object.defineProperty(globalThis, "document", { configurable: true, value: realm.document });
  try {
    const f = await interrupted();
    const oldID = f.live.connectionRecovery!()!().recovery_id;
    const connectID = connectionDiagnostics().filter(r => r.event === "connect_start").at(-1)!.connect_id;
    visibility = "hidden";
    realm.document.dispatchEvent(new realm.Event("visibilitychange"));
    visibility = "visible";
    realm.document.dispatchEvent(new realm.Event("visibilitychange"));
    const newID = f.live.connectionRecovery!()!().recovery_id;
    expect(newID).not.toBe(oldID);
    f.stale.releaseLate();
    await until(() => f.live.isConnected());
    expect(SessionSocket.instances).toHaveLength(2);
    const ready = connectionDiagnostics().filter(r => r.event === "session_ready" && r.connect_id === connectID).at(-1)!;
    expect(ready.recovery_id).toBe(newID);
    expect(connectionDiagnostics().filter(r => r.event === "recovery_ready").at(-1)!.recovery_id).toBe(newID);
  } finally {
    live?.close();
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
}, 15000);
