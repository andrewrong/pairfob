import { describe, expect, test } from "bun:test";
import { DataFrameChannel } from "./data-channel.ts";
import { directFrameWireBytes } from "./direct-frame.ts";
import { CHANNEL_WRITE_BUDGET } from "./frame-channel.ts";
import { FrameSocket } from "./frame-socket.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    for (const listener of this.listeners.get(type) ?? []) listener({ type, ...detail } as Event);
  }
}

class FakeRTC extends FakeTarget {
  binaryType: BinaryType = "arraybuffer";
  readyState: RTCDataChannelState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  close(): void {
    this.readyState = "closed";
    this.emit("close");
  }
}

class FakePeer extends FakeTarget {
  iceConnectionState: RTCIceConnectionState = "connected";
  connectionState: RTCPeerConnectionState = "connected";
  close(): void {}
}

function p2p(rtc?: FakeRTC): { link: DataFrameChannel; rtc: FakeRTC } {
  const channel = rtc ?? new FakeRTC();
  const link = new DataFrameChannel(channel as unknown as RTCDataChannel, new FakePeer() as unknown as RTCPeerConnection);
  return { link, rtc: channel };
}

describe("DataFrameChannel.waitWritable pre-seal budget", () => {
  test("resolves immediately when a frame fits", async () => {
    const { link } = p2p();
    await link.waitWritable!(100);
  });

  test("waits while the buffer is high and only proceeds after the low-water event", async () => {
    const { link, rtc } = p2p();
    rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
    let settled = false;
    const ready = link.waitWritable!(100).then(() => { settled = true; });
    await sleep(40);
    expect(settled).toBe(false);
    rtc.bufferedAmount = 0;
    rtc.emit("bufferedamountlow");
    await ready;
    expect(settled).toBe(true);
  });

  test("bounded poll fallback releases the wait even if the low-water notification is missed", async () => {
    const { link, rtc } = p2p();
    rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
    const ready = link.waitWritable!(100);
    await sleep(40);
    // Drain WITHOUT emitting the event; the 16 ms poll must observe it.
    rtc.bufferedAmount = 0;
    await ready;
  });

  test("accounts for the full encoded frame AND every 12 B P2P fragment header at the exact boundary", async () => {
    const { link, rtc } = p2p();
    const maxFrame = 24 + 262_144; // envelope header + max AEAD payload
    const wireNeed = directFrameWireBytes(maxFrame);
    expect(wireNeed).toBe(262_372); // 262168 + 17 fragment headers

    rtc.bufferedAmount = CHANNEL_WRITE_BUDGET - wireNeed;
    await link.waitWritable!(maxFrame);

    rtc.bufferedAmount = CHANNEL_WRITE_BUDGET - wireNeed + 1;
    let settled = false;
    const ready = link.waitWritable!(maxFrame).then(() => { settled = true; });
    await sleep(40);
    expect(settled).toBe(false);
    rtc.bufferedAmount -= 1;
    rtc.emit("bufferedamountlow");
    await ready;
  });

  test("abort signal rejects and stops polling", async () => {
    const { link, rtc } = p2p();
    rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
    const controller = new AbortController();
    const ready = link.waitWritable!(100, controller.signal);
    await sleep(20);
    controller.abort();
    const error = await ready.catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    await sleep(40); // no throw, no lingering poll effects
  });

  test("timeout rejects with a timeout error and never sends", async () => {
    const { link, rtc } = p2p();
    rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
    const error = await link.waitWritable!(100, undefined, 30).catch((caught) => caught);
    expect((error as { code?: string }).code).toBe("timeout");
  });

  test("channel close while waiting rejects immediately", async () => {
    const { link, rtc } = p2p();
    rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
    const ready = link.waitWritable!(100);
    const closed = new Promise((resolve) => link.onClose(resolve));
    rtc.close();
    await closed;
    const error = await ready.catch((caught) => caught);
    expect((error as { code?: string }).code).toBe("disconnected");
  });

  test("a non-open channel rejects before registering a wait", async () => {
    const { link, rtc } = p2p();
    rtc.readyState = "connecting";
    const error = await link.waitWritable!(100).catch((caught) => caught);
    expect((error as { code?: string }).code).toBe("disconnected");
  });

  test("100 wait/drain cycles leave no drain or close listeners attached (baseline restored every cycle)", async () => {
    const { link, rtc } = p2p();
    const rtcListeners = () =>
      ((rtc as unknown as { listeners: Map<string, Set<unknown>> }).listeners.get("bufferedamountlow")?.size ?? 0);
    const closeHandlers = () => (link as unknown as { closeHandlers: Set<unknown> }).closeHandlers.size;
    expect(rtcListeners()).toBe(0);
    expect(closeHandlers()).toBe(0);
    let peakDrain = 0;
    let peakClose = 0;
    for (let cycle = 0; cycle < 100; cycle++) {
      rtc.bufferedAmount = CHANNEL_WRITE_BUDGET;
      const ready = link.waitWritable!(100);
      await sleep(0);
      peakDrain = Math.max(peakDrain, rtcListeners());
      peakClose = Math.max(peakClose, closeHandlers());
      rtc.bufferedAmount = 0;
      rtc.emit("bufferedamountlow");
      await ready;
      // Every settle detaches drain AND close subscriptions immediately.
      expect(rtcListeners()).toBe(0);
      expect(closeHandlers()).toBe(0);
    }
    // Exactly one drain/close subscription per live wait — never accumulated.
    expect(peakDrain).toBe(1);
    expect(peakClose).toBe(1);
  });
});

class FakeWS extends EventTarget {
  binaryType: BinaryType = "arraybuffer";
  readyState = WebSocket.OPEN;
  bufferedAmount: number | undefined = 0;
  sends = 0;
  send(): void { this.sends++; }
  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

describe("FrameSocket.waitWritable relay buffer budget", () => {
  test("waits on a real WebSocket bufferedAmount and releases via the bounded poll", async () => {
    const ws = new FakeWS();
    const link = new FrameSocket(ws as unknown as WebSocket);
    ws.bufferedAmount = CHANNEL_WRITE_BUDGET;
    let settled = false;
    const ready = link.waitWritable!(200).then(() => { settled = true; });
    await sleep(40);
    expect(settled).toBe(false);
    ws.bufferedAmount = 0;
    await ready;
    expect(ws.sends).toBe(0); // readiness never writes
  });

  test("an adapter without bufferedAmount stays compatible and resolves immediately", async () => {
    const ws = new FakeWS();
    ws.bufferedAmount = undefined;
    const link = new FrameSocket(ws as unknown as WebSocket);
    await link.waitWritable!(500);
  });

  test("close while waiting rejects", async () => {
    const ws = new FakeWS();
    const link = new FrameSocket(ws as unknown as WebSocket);
    ws.bufferedAmount = CHANNEL_WRITE_BUDGET;
    const ready = link.waitWritable!(200);
    link.close();
    const error = await ready.catch((caught) => caught);
    expect((error as { code?: string }).code).toBe("disconnected");
  });

  test("abort and timeout both settle the wait and clean up", async () => {
    const ws = new FakeWS();
    const link = new FrameSocket(ws as unknown as WebSocket);
    ws.bufferedAmount = CHANNEL_WRITE_BUDGET;
    const controller = new AbortController();
    const aborted = link.waitWritable!(200, controller.signal).catch((caught) => (caught as { code?: string }).code);
    controller.abort();
    expect(await aborted).toBe("aborted");

    const timedOut = link.waitWritable!(200, undefined, 25).catch((caught) => (caught as { code?: string }).code);
    expect(await timedOut).toBe("timeout");
  });
});
