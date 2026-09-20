import { describe, expect, test } from "bun:test";
import { Direction, DIR_C, DIR_S } from "./aead.ts";
import { DataFrameChannel } from "./data-channel.ts";
import { DirectFrameAssembler, splitDirectFrame } from "./direct-frame.ts";
import { encode, decode, Typ, type Frame } from "./envelope.ts";
import { ProtocolError } from "./errors.ts";
import type { FrameChannel, FrameChannelKind } from "./frame-channel.ts";
import { CHANNEL_WRITE_BUDGET } from "./frame-channel.ts";
import { heartbeatPayload } from "./frame-socket.ts";
import { MAX_BULK_IN_FLIGHT, SessionTransport } from "./session-transport.ts";
import { trackMutationDelivery } from "./session-ws.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const UPLOAD_ID = "00000000-0000-4000-8000-000000000001";

class FakeTarget {
  private listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener): void {
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, detail?: Record<string, unknown>): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, ...detail } as Event);
  }
}

class BulkRTC extends FakeTarget {
  binaryType: BinaryType = "arraybuffer";
  readyState: RTCDataChannelState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sent: ArrayBuffer[] = [];
  failNext = 0;
  send(data: ArrayBuffer): void {
    if (this.failNext > 0) { this.failNext--; throw new Error("send failed"); }
    this.sent.push(data);
    // Real RTCDataChannel accounts queued bytes until the network drains them.
    this.bufferedAmount += data.byteLength;
  }
  close(): void {
    this.readyState = "closed";
    this.emit("close");
  }
  message(data: ArrayBuffer): void { this.emit("message", { data }); }
}

class BulkPeer extends FakeTarget {
  iceConnectionState: RTCIceConnectionState = "connected";
  connectionState: RTCPeerConnectionState = "connected";
  close(): void {
    this.iceConnectionState = "closed";
    this.connectionState = "closed";
  }
}

function keys(): { c2s: Direction; s2c: Direction; route: Uint8Array } {
  const key = new Uint8Array(32).fill(7);
  return { c2s: new Direction(key, DIR_C), s2c: new Direction(key, DIR_S), route: new Uint8Array(16).fill(3) };
}

function harness() {
  const key = new Uint8Array(32).fill(7);
  const route = new Uint8Array(16).fill(3);
  const c2s = new Direction(key, DIR_C);
  const s2c = new Direction(key, DIR_S);
  const server = new Direction(key, DIR_S); // reply sealer; distinct seq counter
  const rtc = new BulkRTC();
  const peer = new BulkPeer();
  const channel = new DataFrameChannel(rtc as unknown as RTCDataChannel, peer as unknown as RTCPeerConnection);
  const transport = new SessionTransport(channel, route, c2s, s2c, () => {});
  const disconnects: string[] = [];
  transport.onDisconnect((error) => disconnects.push(error.code));
  return { c2s, route, rtc, server, transport, disconnects, cleanup: () => transport.close() };
}

function assembleFrames(buffers: ArrayBuffer[]): Frame[] {
  // One assembler over the whole stream: interleaved or reordered fragments
  // throw, so decoding everything also proves whole-frame fragment integrity.
  const assembler = new DirectFrameAssembler();
  const frames: Frame[] = [];
  for (const data of buffers) {
    const complete = assembler.push(new Uint8Array(data));
    if (complete) frames.push(decode(complete));
  }
  return frames;
}

function fwdMessages(h: { rtc: BulkRTC; route: Uint8Array }): Array<{ id: string; op: string }> {
  const reader = new Direction(new Uint8Array(32).fill(7), DIR_C);
  return assembleFrames(h.rtc.sent)
    .filter((frame) => frame.typ === Typ.FWD)
    .map((frame) => JSON.parse(new TextDecoder().decode(reader.open(h.route, frame.payload))) as { id: string; op: string });
}

function reply(h: { rtc: BulkRTC; server: Direction; route: Uint8Array }, id: string, result: unknown = {}): void {
  const payload = h.server.seal(h.route, new TextEncoder().encode(JSON.stringify({ v: 1, id, ok: true, result })));
  for (const chunk of splitDirectFrame(encode({ version: 1, typ: Typ.FWD, flags: 0, routeId: h.route, payload }))) {
    h.rtc.message(chunk.buffer as ArrayBuffer);
  }
}

function inboundPing(h: { rtc: BulkRTC; route: Uint8Array }, counter: bigint): void {
  for (const chunk of splitDirectFrame(encode({
    version: 1, typ: Typ.PING, flags: 0, routeId: h.route, payload: heartbeatPayload(counter),
  }))) {
    h.rtc.message(chunk.buffer as ArrayBuffer);
  }
}

const writeParams = (index: number, version: "" | "V2" = "V2", data = "AAAA") => ({
  pane_id: "w1:p1", upload_id: UPLOAD_ID, offset: index * 131_072, data_b64: data,
});
const writeOp = (version: "" | "V2") => `WorkspaceUploadWrite${version}`;

describe("bulk pre-seal QoS in SessionTransport", () => {
  test("a buffered bulk write waits, while interactive RPC and control PONG still send, then proceeds after drain", async () => {
    const h = harness();
    try {
      h.rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
      let marked = false;
      const bulk = trackMutationDelivery((markSent) =>
        h.transport.rpc(writeOp("V2"), writeParams(0), 5_000, () => { marked = true; markSent(); })).catch((error) => error);
      await sleep(40);
      expect(h.c2s.seq).toBe(0n);
      expect(fwdMessages(h)).toHaveLength(0); // no nonce, no frame while waiting
      expect(marked).toBe(false);

      // Interactive RPCs never wait on the bulk budget.
      const ping = h.transport.rpc("Ping", { t_ms: 1 });
      await sleep(5);
      expect(h.c2s.seq).toBe(1n);
      // A server PING must still be answered with a control PONG on the same wire.
      inboundPing(h, 42n);
      const frames = assembleFrames(h.rtc.sent);
      expect(frames.some((frame) => frame.typ === Typ.PONG)).toBe(true);
      const pingId = fwdMessages(h).find((message) => message.op === "Ping")!.id;
      reply(h, pingId, { t: 1 });
      expect(await ping).toEqual({ t: 1 });

      // Drain releases the bulk writer; it seals only AFTER room appeared.
      h.rtc.bufferedAmount = 0;
      h.rtc.emit("bufferedamountlow");
      await sleep(40);
      expect(h.c2s.seq).toBe(2n);
      expect(marked).toBe(true); // onSent fires only after the actual whole send
      const bulkId = fwdMessages(h).find((message) => message.op === writeOp("V2"))!.id;
      reply(h, bulkId, {});
      expect(await bulk).toEqual({});
    } finally { h.cleanup(); }
  });

  test(`exactly ${MAX_BULK_IN_FLIGHT} bulk jobs (waiting + sent); a 5th is rejected before any allocation`, async () => {
    const h = harness();
    try {
      const bulks: Promise<unknown>[] = [];
      for (let i = 0; i < MAX_BULK_IN_FLIGHT; i++) {
        bulks.push(h.transport.rpc(writeOp("V2"), writeParams(i), 5_000).catch((error) => error));
      }
      await sleep(40);
      const firstFour = fwdMessages(h);
      expect(firstFour).toHaveLength(MAX_BULK_IN_FLIGHT);
      expect(h.c2s.seq).toBe(4n);
      const active = () => (h.transport as unknown as { bulkActive: number }).bulkActive;
      expect(active()).toBe(MAX_BULK_IN_FLIGHT);

      // The 5th is rejected IMMEDIATELY with backpressure: it is never queued,
      // never sent, and does not wait for an earlier slot to release.
      const fifth = await h.transport.rpc(writeOp("V2"), writeParams(4), 5_000).catch((error) => error) as ProtocolError;
      expect(fifth).toBeInstanceOf(ProtocolError);
      expect(fifth.code).toBe("backpressure");
      expect(active()).toBe(MAX_BULK_IN_FLIGHT);
      expect(fwdMessages(h)).toHaveLength(4);

      // Interactive RPCs still have 28 pending slots and seal past the blocked bulk tail.
      const snapshot = h.transport.rpc("Snapshot", { session: null });
      await sleep(5);
      expect(fwdMessages(h)).toHaveLength(5);
      const snapshotId = fwdMessages(h).find((message) => message.op === "Snapshot")!.id;
      reply(h, snapshotId, {});
      await snapshot;

      // Only once an admitted bulk settles (count released) is a new bulk admitted.
      reply(h, firstFour[0]!.id, {});
      await bulks[0];
      await sleep(10);
      expect(active()).toBe(3);
      const replacement = h.transport.rpc(writeOp("V2"), writeParams(5), 5_000);
      await sleep(20);
      const all = fwdMessages(h);
      expect(all).toHaveLength(6);
      expect(all[5]!.op).toBe(writeOp("V2"));
      for (const message of all) {
        if (message.op === writeOp("V2") && message.id !== firstFour[0]!.id) reply(h, message.id, {});
      }
      await Promise.all([...bulks.slice(1), replacement]);
      await sleep(10);
      expect(active()).toBe(0);
    } finally { h.cleanup(); }
  });

  test("repeated short-timeout bulk calls release their count and can never grow a queue past 4", async () => {
    const h = harness();
    try {
      h.rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
      const active = () => (h.transport as unknown as { bulkActive: number }).bulkActive;
      for (let cycle = 0; cycle < 5; cycle++) {
        const timed: Promise<unknown>[] = [];
        for (let i = 0; i < MAX_BULK_IN_FLIGHT; i++) {
          timed.push(h.transport.rpc(writeOp("V2"), writeParams(cycle * 10 + i), 30).catch((error) => error));
        }
        const rejected = await h.transport.rpc(writeOp("V2"), writeParams(999), 30).catch((error) => error) as ProtocolError;
        expect(rejected.code).toBe("backpressure");
        const errors = await Promise.all(timed) as ProtocolError[];
        expect(errors.every((error) => error.code === "timeout")).toBe(true);
        await sleep(20);
        expect(active()).toBe(0);
      }
      // No bulk frame was ever sealed across all cycles.
      expect(h.c2s.seq).toBe(0n);
      expect(fwdMessages(h)).toHaveLength(0);
    } finally { h.cleanup(); }
  });

  test("4 simultaneous jobs on a draining high backlog never burst the buffer past the 1 MiB bulk budget", async () => {
    const h = harness();
    try {
      // Calibrate the real whole-frame wire cost of one full-size V2 write.
      const B64_128K = "A".repeat(174_764); // base64 of 131072 bytes
      h.rtc.bufferedAmount = 0;
      const calibrated = h.transport.rpc(writeOp("V2"), writeParams(1, "V2", B64_128K), 5_000);
      await sleep(20);
      const NEED = h.rtc.bufferedAmount; // one whole frame is queued from a zero backlog
      expect(NEED).toBeGreaterThan(100_000);
      const calId = fwdMessages(h)[0]!.id;
      reply(h, calId, {});
      await calibrated;

      // Exactly one frame of headroom: a naive parallel burst would overshoot.
      h.rtc.bufferedAmount = CHANNEL_WRITE_BUDGET - NEED;
      const jobs: Promise<unknown>[] = [];
      for (let i = 1; i <= 4; i++) {
        jobs.push(h.transport.rpc(writeOp("V2"), writeParams(i, "V2", B64_128K), 5_000).catch((error) => error));
      }
      await sleep(30);
      expect(fwdMessages(h).slice(1).map((message) => message.op)).toEqual([writeOp("V2")]); // only job 1 sealed
      let peak = h.rtc.bufferedAmount;

      // Each single-frame drain releases exactly ONE serialized job.
      for (let drained = 0; drained < 3; drained++) {
        h.rtc.bufferedAmount -= NEED;
        h.rtc.emit("bufferedamountlow");
        await sleep(30);
        peak = Math.max(peak, h.rtc.bufferedAmount);
      }
      // The buffer never crossed the budget, and all four jobs sealed exactly once.
      expect(peak).toBeLessThanOrEqual(CHANNEL_WRITE_BUDGET);
      expect(fwdMessages(h).slice(1)).toHaveLength(4);
      for (const message of fwdMessages(h).slice(1)) reply(h, message.id, {});
      await Promise.all(jobs);
    } finally { h.cleanup(); }
  });

  test("a readiness failure settles the RPC immediately with the original error and does not retire the healthy epoch", async () => {
    const { c2s, s2c, route } = keys();
    const channel = new ReadyFailChannel();
    const transport = new SessionTransport(channel, route, c2s, s2c, () => {});
    const disconnects: string[] = [];
    transport.onDisconnect((error) => disconnects.push(error.code));
    try {
      const start = performance.now();
      const error = await transport.rpc(writeOp("V2"), writeParams(0), 45_000).catch((caught) => caught) as ProtocolError;
      expect(performance.now() - start).toBeLessThan(500); // settled now, not at the 45 s deadline
      expect(error.code).toBe("backpressure");
      expect(c2s.seq).toBe(0n); // no nonce allocated
      expect(channel.fwd()).toHaveLength(0);
      expect(disconnects).toEqual([]); // healthy epoch is NOT retired for local backpressure

      // Count released and epoch usable: an interactive RPC still seals/resolves.
      const ping = transport.rpc("Ping", { t_ms: 1 });
      await sleep(5);
      expect(c2s.seq).toBe(1n);
      const reader = new Direction(new Uint8Array(32).fill(7), DIR_C);
      const id = JSON.parse(new TextDecoder().decode(reader.open(route, channel.fwd()[0]!.payload))) as { id: string };
      const server = new Direction(new Uint8Array(32).fill(7), DIR_S);
      channel.deliver({
        version: 1, typ: Typ.FWD, flags: 0, routeId: route,
        payload: server.seal(route, new TextEncoder().encode(JSON.stringify({ v: 1, id: id.id, ok: true, result: { t: 1 } }))),
      });
      expect(await ping).toEqual({ t: 1 });
    } finally { transport.close(); }
  });

  test("a deadline before seal is a plain timeout: no frame, no nonce, not unknown_outcome, and no late send", async () => {
    const h = harness();
    try {
      h.rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
      let marked = false;
      const timed = await trackMutationDelivery((markSent) =>
        h.transport.rpc(writeOp("V2"), writeParams(0), 40, () => { marked = true; markSent(); })).catch((error) => error);
      expect(timed).toBeInstanceOf(ProtocolError);
      expect((timed as ProtocolError).code).toBe("timeout");
      expect(h.c2s.seq).toBe(0n);
      expect(marked).toBe(false);

      // A later drain must not make the timed-out request seal.
      h.rtc.bufferedAmount = 0;
      h.rtc.emit("bufferedamountlow");
      await sleep(50);
      expect(fwdMessages(h)).toHaveLength(0);

      // The admission slot was released and the nonce was never consumed.
      const retry = trackMutationDelivery((markSent) =>
        h.transport.rpc(writeOp("V2"), writeParams(1), 5_000, () => { marked = true; markSent(); }));
      await sleep(20);
      expect(h.c2s.seq).toBe(1n);
      const retryId = fwdMessages(h)[0]!.id;
      reply(h, retryId, {});
      await retry;
    } finally { h.cleanup(); }
  });

  test("close before seal rejects the waiting bulk and a later drain never sends", async () => {
    const h = harness();
    try {
      h.rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
      const bulk = h.transport.rpc(writeOp("V2"), writeParams(0), 5_000).catch((error) => error);
      await sleep(30);
      h.transport.close();
      const error = await bulk as ProtocolError;
      expect(error.code).toBe("closed");
      expect(h.c2s.seq).toBe(0n);
      h.rtc.bufferedAmount = 0;
      h.rtc.emit("bufferedamountlow");
      await sleep(40);
      expect(fwdMessages(h)).toHaveLength(0);
    } finally { h.cleanup(); }
  });

  test("a send failure AFTER the seal still allocates the nonce and retires the epoch", async () => {
    const h = harness();
    try {
      h.rtc.failNext = 1;
      let marked = false;
      const error = await trackMutationDelivery((markSent) =>
        h.transport.rpc(writeOp("V2"), writeParams(0), 5_000, () => { marked = true; markSent(); })).catch((caught) => caught);
      expect(error).toBeInstanceOf(ProtocolError);
      expect(["disconnected", "backpressure"]).toContain((error as ProtocolError).code);
      expect(h.c2s.seq).toBe(1n); // sealed: the nonce is used, epoch must not continue
      expect(marked).toBe(false); // whole frame did not return from send
      expect(h.disconnects).toContain("disconnected");
      expect(h.rtc.readyState).toBe("closed");

      const later = await h.transport.rpc("Ping", { t_ms: 1 }).catch((caught) => caught);
      expect((later as ProtocolError).code).toBe("disconnected");
      expect(h.c2s.seq).toBe(1n);
    } finally { h.cleanup(); }
  });

  test("mixed interactive/bulk traffic keeps a contiguous AEAD sequence and whole-fragment frames", async () => {
    const h = harness();
    try {
      h.rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
      const legacy = h.transport.rpc(writeOp(""), writeParams(0, ""), 5_000).catch((error) => error);
      const v2 = h.transport.rpc(writeOp("V2"), writeParams(1), 5_000).catch((error) => error);
      await sleep(30);

      const snapshot = h.transport.rpc("Snapshot", { session: null });
      const ping = h.transport.rpc("Ping", { t_ms: 9 });
      await sleep(10);
      inboundPing(h, 7n); // control PONG interleaves without touching AEAD ordering

      h.rtc.bufferedAmount = 0;
      h.rtc.emit("bufferedamountlow");
      await sleep(40);

      const messages = fwdMessages(h);
      expect(messages.map((message) => message.op)).toEqual([
        "Snapshot", "Ping", writeOp(""), writeOp("V2"),
      ]);
      expect(h.c2s.seq).toBe(4n);

      const snapshotId = messages.find((message) => message.op === "Snapshot")!.id;
      const pingId = messages.find((message) => message.op === "Ping")!.id;
      reply(h, snapshotId, {});
      reply(h, pingId, { t: 9 });
      for (const message of messages) {
        if (message.op === writeOp("") || message.op === writeOp("V2")) reply(h, message.id, {});
      }
      await Promise.all([snapshot, ping, legacy, v2]);

      // The complete wire (incl. heartbeat PING/PONG) assembles without gaps.
      const allFrames = assembleFrames(h.rtc.sent);
      expect(allFrames.filter((frame) => frame.typ === Typ.FWD)).toHaveLength(4);
      expect(allFrames.some((frame) => frame.typ === Typ.PONG)).toBe(true);
    } finally { h.cleanup(); }
  });
});

class PlainChannel implements FrameChannel {
  readonly kind: FrameChannelKind = "relay";
  readonly sent: Frame[] = [];
  closed: { code?: number } | null = null;
  private handler: ((frame: Frame) => void) | null = null;
  private readonly closeHandlers = new Set<(error: ProtocolError) => void>();
  // Deliberately NO waitWritable: old adapters must stay compatible.
  send(frame: Frame): void {
    if (this.closed) throw new ProtocolError("disconnected", "连接已断开");
    this.sent.push(frame);
  }
  close(code?: number): void {
    if (this.closed) return;
    this.closed = { code };
    for (const handler of this.closeHandlers) handler(new ProtocolError("disconnected", "连接已断开"));
  }
  next(): Promise<Frame> { return Promise.reject(new ProtocolError("disconnected", "unused")); }
  use(handler: (frame: Frame) => void): void { this.handler = handler; }
  onClose(handler: (error: ProtocolError) => void): () => void {
    this.closeHandlers.add(handler);
    return () => { this.closeHandlers.delete(handler); };
  }
  deliver(frame: Frame): void { this.handler?.(frame); }
  fwd(): Frame[] { return this.sent.filter((frame) => frame.typ === Typ.FWD); }
}

class ReadyFailChannel extends PlainChannel {
  // Local readiness failure WITHOUT an epoch close: simulates a channel-level
  // budget rejection while the transport itself stays healthy.
  waitWritable(): Promise<void> {
    return Promise.reject(new ProtocolError("backpressure", "local buffer not writable"));
  }
}

test("adapters without waitWritable keep the old behavior: bulk sends immediately, interactive send stays synchronous", async () => {
  const { c2s, s2c, route } = keys();
  const channel = new PlainChannel();
  const transport = new SessionTransport(channel, route, c2s, s2c, () => {});
  try {
    void transport.rpc("Snapshot", { session: null }).catch(() => undefined);
    expect(channel.fwd()).toHaveLength(1); // interactive still seals in the entry tick

    const bulk = transport.rpc(writeOp("V2"), writeParams(0), 5_000);
    await sleep(5);
    expect(channel.fwd()).toHaveLength(2);

    const reader = new Direction(new Uint8Array(32).fill(7), DIR_C);
    reader.open(route, channel.fwd()[0]!.payload); // interactive frame used nonce 0
    const request = JSON.parse(new TextDecoder().decode(reader.open(route, channel.fwd()[1]!.payload))) as { id: string };
    const server = new Direction(new Uint8Array(32).fill(7), DIR_S);
    channel.deliver({
      version: 1, typ: Typ.FWD, flags: 0, routeId: route,
      payload: server.seal(route, new TextEncoder().encode(JSON.stringify({ v: 1, id: request.id, ok: true, result: {} }))),
    });
    expect(await bulk).toEqual({});
    expect(c2s.seq).toBe(2n);
  } finally { transport.close(); }
});
