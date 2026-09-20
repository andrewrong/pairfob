// Self-contained encrypted-transport wire for the probe-wait isolated child
// (process-global mock.module suite, spawned from
// src/lib/protocol/session-upload-probe-wait.test.ts). Production AEAD,
// envelope parsing and SessionTransport drive this; negotiation I/O is stubbed
// in the child. Local copy of the root test-support wire plus scriptable Ping
// holding.
import { Direction, DIR_C, DIR_S } from "../src/lib/protocol/aead.ts";
import { decode, Typ, jsonFrame, type Frame } from "../src/lib/protocol/envelope.ts";
import { ProtocolError } from "../src/lib/protocol/errors.ts";

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

export class ProbeWire {
  readonly route: Uint8Array;
  readonly ckey: Uint8Array;
  readonly skey: Uint8Array;
  readonly recv: Direction;
  readonly sendDirection: Direction;
  requests: { id: string; op: string; params: Record<string, unknown> }[] = [];
  closed = false;
  handler: ((frame: Frame) => void) | null = null;
  closeHandlers = new Set<(error: ProtocolError) => void>();
  seen = new Map<string, ReturnType<typeof deferred<unknown>>>();
  /** When true, encrypted RPC Ping replies are parked in `held`; heartbeat PONGs bypass this. */
  hold = false;
  held: Array<{ req: { id: string }; result: unknown; ok: boolean }> = [];
  ws: { readyState: number; send: (bytes: ArrayBuffer) => void; close: () => void };

  constructor(readonly kind: "relay" | "p2p", serial: number) {
    this.route = new Uint8Array(16).fill(serial);
    this.ckey = new Uint8Array(32).fill(serial + 10);
    this.skey = new Uint8Array(32).fill(serial + 20);
    this.recv = new Direction(this.ckey, DIR_C);
    this.sendDirection = new Direction(this.skey, DIR_S);
    this.ws = {
      readyState: 1,
      send: (bytes: ArrayBuffer) => this.send(decode(new Uint8Array(bytes))),
      close: () => this.close(),
    };
  }

  epoch(): { routeId: Uint8Array; c2s: Direction; s2c: Direction } {
    return { routeId: this.route, c2s: new Direction(this.ckey, DIR_C), s2c: new Direction(this.skey, DIR_S) };
  }

  next(): Promise<Frame> { return Promise.resolve(jsonFrame(Typ.SESSION_BOUND, this.route, { v: 2 })); }
  use(handler: (frame: Frame) => void): void { this.handler = handler; }
  onClose(handler: (error: ProtocolError) => void): () => void {
    this.closeHandlers.add(handler);
    return () => { this.closeHandlers.delete(handler); };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const handler of this.closeHandlers) handler(new ProtocolError("disconnected", "fixture wire closed"));
  }

  send(frame: Frame): void {
    if (this.closed) throw new ProtocolError("disconnected", "fixture wire closed");
    // Raw transport heartbeat: echo PONG directly, never held by probe scripting.
    if (frame.typ === Typ.PING) {
      queueMicrotask(() => this.handler?.({ ...frame, typ: Typ.PONG }));
      return;
    }
    if (frame.typ !== Typ.FWD) return;
    const req = JSON.parse(new TextDecoder().decode(this.recv.open(this.route, frame.payload))) as
      { id: string; op: string; params: Record<string, unknown> };
    this.requests.push(req);
    this.seen.get(req.op)?.resolve(req);
    // Encrypted RPC Ping: auto-answer (hold parks it for probe scripting).
    if (req.op === "Ping") queueMicrotask(() => this.reply(req, { t: req.params.t_ms }));
  }

  /** Answer a recorded FWD request (ok) or send an ERROR envelope (ok=false). */
  reply(req: { id: string }, result: unknown, ok = true): void {
    if (this.closed) return;
    const recorded = this.requests.find((entry) => entry.id === req.id);
    if (this.hold && recorded?.op === "Ping") {
      this.held.push({ req, result, ok });
      return;
    }
    this.deliverAnswer(req, result, ok);
  }

  private deliverAnswer(req: { id: string }, result: unknown, ok: boolean): void {
    const body = ok
      ? { v: 1, id: req.id, ok: true, result }
      : { v: 1, id: req.id, ok: false, error: { code: "conflict", message: "retired" } };
    this.handler?.({
      version: 1, typ: Typ.FWD, flags: 0, routeId: this.route,
      payload: this.sendDirection.seal(this.route, new TextEncoder().encode(JSON.stringify(body))),
    });
  }

  wait(op: string): Promise<unknown> {
    const old = this.requests.find((request) => request.op === op);
    if (old) return Promise.resolve(old);
    let waiter = this.seen.get(op);
    if (!waiter) { waiter = deferred<unknown>(); this.seen.set(op, waiter); }
    return waiter.promise;
  }

  /** Release a parked Ping regardless of the current hold flag. */
  confirmPing(): void {
    const next = this.held.shift();
    if (next) this.deliverAnswer(next.req, next.result, next.ok);
  }

  failPing(): void {
    const next = this.held.shift();
    if (next) this.deliverAnswer(next.req, null, false);
  }
}
