// Runs in its OWN bun test process (spawned from
// src/lib/protocol/session-upload-v2.test.ts). Lives in test-support/ so the
// default `bun test src` suite never collects it: like
// media-ownership-isolated.test.ts it stubs process-global network/negotiation
// I/O with mock.module. Production session, DirectSessionDriver, switch barrier
// and both real AEAD transports stay production code; only the wire answers are
// scripted here.
import { test, expect, mock } from "bun:test";
import { Wire } from "./media-wire-fixture";
import { fingerprint16 } from "../src/lib/protocol/hello";
import { bytesToHex } from "../src/lib/protocol/bytes";
import * as sockets from "../src/lib/protocol/frame-socket";
import * as handshake from "../src/lib/protocol/session-handshake";
import * as upgrades from "../src/lib/protocol/session-upgrade";
import type { UploadBeginInput, UploadState, UploadWriteInput } from "../src/lib/protocol/attachments";

let relay: Wire;
let direct: Wire;

// Stub only network/negotiation I/O (same boundary as the media ownership test).
mock.module("../src/lib/protocol/frame-socket", () => ({ ...sockets, openWS: async () => relay as never }));
mock.module("../src/lib/protocol/session-handshake", () => ({
  ...handshake,
  establishSessionEpoch: async (channel: Wire) => channel.epoch(),
}));
mock.module("../src/lib/protocol/session-upgrade", () => ({
  ...upgrades,
  prepareDirectSession: async () => ({
    attemptId: "p2p_0123456789abcdef", iceGathering: "complete", channel: direct,
    epoch: direct.epoch(), close: () => direct.close(),
  }),
}));

const { sessionOverWS } = await import("../src/lib/protocol/session-ws") as {
  sessionOverWS(url: string, pair: object, opts: object): Promise<Live>;
};

const pk = new Uint8Array(32).fill(3);
const pair = {
  daemonId: "d_" + "a".repeat(20), deviceId: "dev_12345678", daemonPk: pk, psk: new Uint8Array(32).fill(9),
  fp: fingerprint16(pk), endpointOrigin: "https://pairfob.com",
};

const UPLOAD_ID = "00000000-0000-4000-8000-000000000001";
const UPLOAD_ID_2 = "00000000-0000-4000-8000-000000000002";
const SHA = "a".repeat(64);

type Live = {
  isConnected(): boolean;
  close(): void;
  onEvent(listener: (event: { type: string }) => void): () => void;
  switchTransport(target: string): Promise<void>;
  getConfig(): Promise<Record<string, unknown>>;
  supportsUploadV2(): boolean;
  workspaceUploadBeginV2(input: UploadBeginInput): Promise<UploadState>;
  workspaceUploadWriteV2(input: UploadWriteInput): Promise<UploadState>;
  workspaceUploadStatusV2(paneId: string, uploadId: string): Promise<UploadState>;
};

const configV2 = (advertised: boolean) => ({
  capabilities: { upload_file: true, upload_file_v2: advertised },
});

function v2State(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    upload_id: UPLOAD_ID, state: "uploading", offset: 0, size: 262_144,
    sha256: SHA, chunk_bytes: 131_072, ...overrides,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve once `wire` has seen at least `count` requests for `op`, in send order. */
async function requestsFor(wire: Wire, op: string, count: number, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = wire.requests.filter((request) => request.op === op);
    if (found.length >= count) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} ${op} (saw ${found.length})`);
    await sleep(2);
  }
}

/** The request at index `after` (i.e. the (after+1)th) for `op`. */
async function nthRequest(wire: Wire, op: string, after: number) {
  return (await requestsFor(wire, op, after + 1))[after];
}

async function learnUploadV2(live: Live, wire: Wire, priorGetConfigs = 0) {
  const pending = live.getConfig();
  const request = await nthRequest(wire, "GetConfig", priorGetConfigs);
  wire.reply(request, configV2(true));
  return pending;
}

async function withSession(run: (live: Live) => Promise<void>) {
  relay = new Wire("relay", 1);
  direct = new Wire("p2p", 2);
  const originalRTC = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, writable: true, value: class {} });
  const live = await sessionOverWS("wss://pairfob.com/v2/ws", pair as never, { p2p: true, networkMode: "relay" });
  try {
    await run(live);
  } finally {
    live.close();
    relay.close();
    direct.close();
    if (originalRTC) Object.defineProperty(globalThis, "RTCPeerConnection", originalRTC);
    else delete (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
  }
}

function nextEventType(live: Live, type: string): Promise<void> {
  return new Promise((resolve) => {
    const off = live.onEvent((event) => {
      if (event.type === type) { off(); resolve(); }
    });
  });
}

test("latest GetConfig wins: a stale TRUE reply arriving after a newer FALSE reply stays false", () => withSession(async (live) => {
  const older = live.getConfig();
  const newer = live.getConfig();
  const [olderReq, newerReq] = await requestsFor(relay, "GetConfig", 2);

  relay.reply(newerReq, configV2(false));
  const newerResult = await newer;
  expect(newerResult.capabilities).toEqual({ upload_file: true, upload_file_v2: false });
  expect(live.supportsUploadV2()).toBe(false);

  relay.reply(olderReq, configV2(true));
  const olderResult = await older;
  // The original result is still returned to its own caller...
  expect((olderResult.capabilities as Record<string, unknown>).upload_file_v2).toBe(true);
  // ...but it must never install over the newer request's answer.
  expect(live.supportsUploadV2()).toBe(false);
}));

test("latest GetConfig wins: a stale FALSE reply arriving after a newer TRUE reply stays true", () => withSession(async (live) => {
  const older = live.getConfig();
  const newer = live.getConfig();
  const [olderReq, newerReq] = await requestsFor(relay, "GetConfig", 2);

  relay.reply(newerReq, configV2(true));
  await newer;
  expect(live.supportsUploadV2()).toBe(true);

  relay.reply(olderReq, configV2(false));
  await older;
  expect(live.supportsUploadV2()).toBe(true);
}));

test("a rejected STALE GetConfig does nothing and cannot clear the newer request's capability", () => withSession(async (live) => {
  const older = live.getConfig();
  const newer = live.getConfig();
  const [olderReq, newerReq] = await requestsFor(relay, "GetConfig", 2);

  relay.reply(newerReq, configV2(true));
  await newer;
  expect(live.supportsUploadV2()).toBe(true);

  relay.reply(olderReq, null, false);
  await expect(older).rejects.toMatchObject({ code: "conflict" });
  expect(live.supportsUploadV2()).toBe(true);
}));

test("a rejected LATEST GetConfig clears a capability learned from the previous read", () => withSession(async (live) => {
  await learnUploadV2(live, relay);
  expect(live.supportsUploadV2()).toBe(true);

  const refresh = live.getConfig();
  const request = await nthRequest(relay, "GetConfig", 1);
  relay.reply(request, null, false);
  await expect(refresh).rejects.toMatchObject({ code: "conflict" });
  // Fail closed: the old true must not survive the failed latest refresh.
  expect(live.supportsUploadV2()).toBe(false);
}));

test("wire disconnect clears the learned capability", () => withSession(async (live) => {
  await learnUploadV2(live, relay);
  expect(live.supportsUploadV2()).toBe(true);

  const disconnected = nextEventType(live, "disconnected");
  relay.close();
  await disconnected;
  expect(live.supportsUploadV2()).toBe(false);
}));

test("close() clears the learned capability", () => withSession(async (live) => {
  await learnUploadV2(live, relay);
  expect(live.supportsUploadV2()).toBe(true);
  live.close();
  expect(live.supportsUploadV2()).toBe(false);
}));

test("a transport switch clears the capability and the next GetConfig on the new epoch relearns it", () => withSession(async (live) => {
  await learnUploadV2(live, relay);
  expect(live.supportsUploadV2()).toBe(true);

  const switching = live.switchTransport("p2p");
  const commit = await relay.wait("TransportCommit") as { id: string; params: { attempt_id: string } };
  relay.reply(commit, {
    attempt_id: commit.params.attempt_id, route_id: bytesToHex(direct.route), transport: "webrtc",
  });
  await switching;

  expect(live.isConnected()).toBe(true);
  expect(relay.closed).toBe(true);
  expect(live.supportsUploadV2()).toBe(false);

  // Relearning goes over the NEW (direct) epoch, never the retired relay epoch.
  const relearn = live.getConfig();
  const request = await nthRequest(direct, "GetConfig", 0);
  direct.reply(request, configV2(true));
  await relearn;
  expect(live.supportsUploadV2()).toBe(true);
  expect(relay.requests.filter((entry) => entry.op === "GetConfig")).toHaveLength(1);
  expect(direct.requests.filter((entry) => entry.op === "GetConfig")).toHaveLength(1);
}));


async function transferWire(live: Live): Promise<Wire> {
  const switching = live.switchTransport("p2p");
  const commit = await relay.wait("TransportCommit") as { id: string; params: { attempt_id: string } };
  relay.reply(commit, { attempt_id: commit.params.attempt_id, route_id: bytesToHex(direct.route), transport: "webrtc" });
  await switching;
  return direct;
}

test("V2 begin/write/status wrappers send the frozen op names with fresh operation ids and parse 131072-byte state", () => withSession(async (live) => {
  const wire = await transferWire(live);
  await learnUploadV2(live, wire);

  const beginInput: UploadBeginInput = {
    pane_id: "w1:p1", upload_id: UPLOAD_ID, name: "a.bin",
    size: 262_144, sha256: SHA, mime: "application/octet-stream",
  };
  const begin = live.workspaceUploadBeginV2(beginInput);
  const beginReq = await nthRequest(wire, "WorkspaceUploadBeginV2", 0);
  expect(beginReq.params).toMatchObject(beginInput);
  expect(beginReq.params.operation_id).toEqual(expect.stringMatching(/^op_[A-Za-z0-9_-]{16,128}$/));
  wire.reply(beginReq, v2State());
  const beginState = await begin;
  expect(beginState.chunk_bytes).toBe(131_072);

  const writeInput: UploadWriteInput = {
    pane_id: "w1:p1", upload_id: UPLOAD_ID, offset: 0, data_b64: "AAAA",
  };
  const write = live.workspaceUploadWriteV2(writeInput);
  const writeReq = await nthRequest(wire, "WorkspaceUploadWriteV2", 0);
  expect(writeReq.params).toMatchObject(writeInput);
  expect(writeReq.params.operation_id).toEqual(expect.stringMatching(/^op_[A-Za-z0-9_-]{16,128}$/));
  // Every mutation carries a FRESH operation id.
  expect(writeReq.params.operation_id).not.toBe(beginReq.params.operation_id);
  wire.reply(writeReq, v2State({ offset: 131_072 }));
  const writeState = await write;
  expect(writeState.offset).toBe(131_072);
  expect(writeState.chunk_bytes).toBe(131_072);

  const status = live.workspaceUploadStatusV2("w1:p1", UPLOAD_ID);
  const statusReq = await nthRequest(wire, "WorkspaceUploadStatusV2", 0);
  // StatusV2 is a read: no operation id is attached.
  expect(statusReq.params).toEqual({ pane_id: "w1:p1", upload_id: UPLOAD_ID });
  wire.reply(statusReq, v2State({ offset: 131_072 }));
  const statusState = await status;
  expect(statusState.chunk_bytes).toBe(131_072);
}));

test("V2 wrappers reject a legacy 32768-byte response and a failed mutation is never auto-retried", () => withSession(async (live) => {
  const wire = await transferWire(live);
  await learnUploadV2(live, wire);

  // A legacy-sized state on a V2 op is a protocol error, not a silent fallback.
  const status = live.workspaceUploadStatusV2("w1:p1", UPLOAD_ID);
  const statusReq = await nthRequest(wire, "WorkspaceUploadStatusV2", 0);
  wire.reply(statusReq, v2State({ chunk_bytes: 32_768 }));
  await expect(status).rejects.toThrow(/响应格式不正确/);

  // A failed BeginV2 surfaces the error and goes out exactly once: no replay.
  const before = wire.requests.filter((entry) => entry.op === "WorkspaceUploadBeginV2").length;
  const begin = live.workspaceUploadBeginV2({
    pane_id: "w1:p1", upload_id: UPLOAD_ID_2, name: "b.bin",
    size: 262_144, sha256: SHA, mime: "application/octet-stream",
  });
  const beginReq = await nthRequest(wire, "WorkspaceUploadBeginV2", before);
  wire.reply(beginReq, null, false);
  await expect(begin).rejects.toMatchObject({ code: "conflict" });
  await sleep(20);
  expect(wire.requests.filter((entry) => entry.op === "WorkspaceUploadBeginV2")).toHaveLength(before + 1);
}));
