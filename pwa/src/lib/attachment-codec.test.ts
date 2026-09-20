import { describe, expect, test } from "bun:test";
import { base64Decode, base64Encode, bytesToHex } from "./protocol/bytes.ts";
import { ProtocolError } from "./protocol/errors.ts";
import {
  CODEC_ENCODE_SUBCHUNK_BYTES,
  CODEC_MAX_CHUNK_BYTES,
  CODEC_MAX_FILE_BYTES,
  checkCodecAbort,
  encodeChunkCore,
  hashFileCore,
} from "./attachment-codec-core.ts";
import {
  CODEC_MAX_ACTIVE_JOBS,
  CODEC_MAX_WAITING_JOBS,
  encodeAttachmentChunk,
  hashAttachmentOffThread,
  type CodecInternals,
  type CodecWorkerHandle,
} from "./attachment-codec.ts";
import {
  isCodecRequest,
  validateCodecReply,
  type CodecReply,
  type CodecRequest,
} from "./attachment-codec-protocol.ts";

// --- helpers -------------------------------------------------------------------------

function makeFile(size: number, name = "data.bin", fillSeed = 0): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + fillSeed + 7) & 0xff;
  return new File([bytes], name, { type: "application/octet-stream" });
}

async function webCryptoDigest(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.slice().arrayBuffer());
  return bytesToHex(new Uint8Array(digest));
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const KIB = 1024;
const MIB = 1024 * KIB;

// --- scripted worker factory ---------------------------------------------------------

type AnyListener = (event: MessageEvent | ErrorEvent) => void;

class FakeWorker {
  terminateCount = 0;
  readonly posted: CodecRequest[] = [];
  readonly messageListeners = new Set<(event: MessageEvent) => void>();
  readonly errorListeners = new Set<(event: ErrorEvent) => void>();
  constructor(private readonly options: { postThrow?: boolean } = {}) {}
  postMessage(message: CodecRequest): void {
    if (this.options.postThrow) throw new Error("structured clone failed");
    this.posted.push(message);
  }
  terminate(): void {
    this.terminateCount += 1;
  }
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: string, listener: AnyListener): void {
    (type === "message" ? this.messageListeners : this.errorListeners)
      .add(listener as never);
  }
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: string, listener: AnyListener): void {
    (type === "message" ? this.messageListeners : this.errorListeners)
      .delete(listener as never);
  }
  emitReply(reply: unknown): void {
    for (const listener of [...this.messageListeners]) listener({ data: reply } as MessageEvent);
  }
  emitError(message = "worker crashed"): void {
    for (const listener of [...this.errorListeners]) listener(new ErrorEvent("error", { message }));
  }
  get cleanedUp(): boolean {
    return this.messageListeners.size === 0 && this.errorListeners.size === 0;
  }
}

type FakeFactory = {
  (): CodecWorkerHandle;
  instances: FakeWorker[];
};

function fakeFactory(options: { postThrow?: boolean; constructorThrow?: boolean } = {}): FakeFactory {
  const factory = (() => {
    if (options.constructorThrow) throw new Error("Worker blocked by CSP");
    const worker = new FakeWorker({ postThrow: options.postThrow });
    factory.instances.push(worker);
    return worker as unknown as CodecWorkerHandle;
  }) as FakeFactory;
  factory.instances = [];
  return factory;
}

function okReplyFor(request: CodecRequest, result: string): CodecReply {
  return { jobId: request.jobId, op: request.op, ok: true, result };
}

function rejectsWith(
  promise: Promise<unknown>,
  predicate: (error: unknown) => boolean,
): Promise<void> {
  return promise.then(
    () => Promise.reject(new Error("expected the promise to reject")),
    (error: unknown) => {
      expect(predicate(error)).toBe(true);
    },
  );
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

/** Worker construction/post happens one async tick after acquiring a slot. */
async function flushTicks(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

function internals(factory: FakeFactory, watchdogMs = 10_000): CodecInternals {
  return { createWorker: factory, watchdogMs };
}

// --- core hashing --------------------------------------------------------------------

describe("attachment codec core: SHA-256", () => {
  test("empty file hashes to the known empty-input vector", async () => {
    expect(await hashFileCore(makeFile(0))).toBe(EMPTY_SHA256);
  });

  test("matches WebCrypto across aligned, unaligned and slice-boundary sizes", async () => {
    const sizes = [0, 1, 2, 3, 4, 5, 6, 31, 32, 33, 1_000, 4_095, 4_096, 4_097,
      256 * KIB - 1, 256 * KIB, 256 * KIB + 1];
    for (const size of sizes) {
      const file = makeFile(size, "x.bin", size);
      expect(await hashFileCore(file)).toBe(await webCryptoDigest(file));
    }
  });

  test("hashes a full 5 MiB file incrementally with identical digest", async () => {
    const file = makeFile(5 * MIB, "five.bin", 11);
    expect(await hashFileCore(file)).toBe(await webCryptoDigest(file));
  });

  test("honours an already-aborted signal before any slice read", async () => {
    const controller = new AbortController();
    controller.abort();
    let reads = 0;
    const file = makeFile(64 * KIB);
    const spying = new Proxy(file, {
      get(target, prop) {
        if (prop === "slice") return (...args: unknown[]) => { reads += 1; return target.slice(...args as [number, number]); };
        return Reflect.get(target, prop);
      },
    });
    await rejectsWith(hashFileCore(spying, controller.signal), isAbort);
    expect(reads).toBe(0);
  });
});

// --- core base64 ---------------------------------------------------------------------

describe("attachment codec core: canonical base64 chunks", () => {
  const unalignedLengths = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 47, 48, 49,
    CODEC_ENCODE_SUBCHUNK_BYTES - 1,
    CODEC_ENCODE_SUBCHUNK_BYTES,
    CODEC_ENCODE_SUBCHUNK_BYTES + 1,
    CODEC_ENCODE_SUBCHUNK_BYTES + 2,
    CODEC_MAX_CHUNK_BYTES - 1,
    CODEC_MAX_CHUNK_BYTES,
  ];

  test("matches one-shot canonical base64 including unaligned lengths", async () => {
    for (const length of unalignedLengths) {
      const file = makeFile(Math.max(length, 1), "chunk.bin", length);
      const encoded = length === 0
        ? await encodeChunkCore(makeFile(0), 0, 0)
        : await encodeChunkCore(file, 0, length);
      const expected = length === 0 ? "" : base64Encode(new Uint8Array(await file.slice(0, length).arrayBuffer()));
      expect(encoded).toBe(expected);
      // Round trip recovers exactly the original bytes.
      const decoded = encoded === "" ? new Uint8Array() : base64Decode(encoded);
      expect(decoded).toEqual(new Uint8Array(await file.slice(0, length).arrayBuffer()));
    }
  });

  test("aligned subchunks concatenate without spurious padding", async () => {
    // 2.5 subchunks forces two interior (triplet-aligned) pieces plus a
    // padded tail; only the tail may contain '='.
    const length = CODEC_ENCODE_SUBCHUNK_BYTES * 2 + 5;
    const file = makeFile(length);
    const encoded = await encodeChunkCore(file, 0, length);
    const paddingIndex = encoded.indexOf("=");
    if (paddingIndex >= 0) expect(encoded.indexOf("=", paddingIndex + 1)).toBe(-1);
    expect(paddingIndex === -1 || paddingIndex >= encoded.length - 2).toBe(true);
    expect(encoded).toBe(base64Encode(new Uint8Array(await file.arrayBuffer())));
  });

  test("non-zero offsets encode exactly that window", async () => {
    const file = makeFile(300 * KIB, "window.bin", 5);
    const cases: Array<[number, number]> = [[0, 1], [3, 7], [100_000, 100_001], [100_000, 100_003],
      [300 * KIB - CODEC_MAX_CHUNK_BYTES, 300 * KIB]];
    for (const [offset, end] of cases) {
      const encoded = await encodeChunkCore(file, offset, end);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      expect(encoded).toBe(base64Encode(bytes));
      expect(base64Decode(encoded)).toEqual(bytes);
    }
  });

  test("known short vectors are exact", async () => {
    const text = new TextEncoder().encode("foobar");
    const file = new File([text], "t.txt", { type: "text/plain" });
    expect(await encodeChunkCore(file, 0, 6)).toBe("Zm9vYmFy");
    expect(await encodeChunkCore(file, 0, 1)).toBe("Zg==");
    expect(await encodeChunkCore(file, 1, 3)).toBe("b28="); // "oo"
    expect(await encodeChunkCore(file, 3, 6)).toBe("YmFy"); // "bar"
  });

  test("validates ranges and the 128 KiB / 20 MiB limits", async () => {
    const file = makeFile(10);
    const invalid: Array<[number, number]> = [[-1, 1], [0, -1], [5, 4], [0, 11]];
    for (const [offset, end] of invalid) {
      await rejectsWith(encodeChunkCore(file, offset, end), (e) => e instanceof RangeError);
    }
    await rejectsWith(
      encodeChunkCore(makeFile(CODEC_MAX_CHUNK_BYTES + 1), 0, CODEC_MAX_CHUNK_BYTES + 1),
      (e) => e instanceof RangeError,
    );
    const tooBig = { size: CODEC_MAX_FILE_BYTES + 1, slice: () => ({ arrayBuffer: () => new ArrayBuffer(0) }) } as unknown as File;
    await rejectsWith(hashFileCore(tooBig), (e) => e instanceof TypeError);
  });

  test("an aborted chunk encode never reads", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => checkCodecAbort(controller.signal)).toThrow();
    await rejectsWith(encodeChunkCore(makeFile(10), 0, 10, controller.signal), isAbort);
  });
});

// --- protocol validation -------------------------------------------------------------

describe("codec protocol validation", () => {
  test("accepts only structurally complete requests", () => {
    const file = makeFile(4);
    expect(isCodecRequest({ jobId: "j", op: "sha256", file })).toBe(true);
    expect(isCodecRequest({ jobId: "j", op: "b64chunk", file, offset: 0, end: 4 })).toBe(true);
    expect(isCodecRequest({ jobId: "", op: "sha256", file })).toBe(false);
    expect(isCodecRequest({ jobId: "j", op: "sha256", file: {} })).toBe(false);
    expect(isCodecRequest({ jobId: "j", op: "other", file })).toBe(false);
    expect(isCodecRequest({ jobId: "j", op: "b64chunk", file, offset: 1.5, end: 4 })).toBe(false);
    expect(isCodecRequest(null)).toBe(false);
  });

  test("validates replies against the request and byte count", () => {
    const file = makeFile(4);
    const request: CodecRequest = { jobId: "j1", op: "b64chunk", file, offset: 0, end: 4 };
    const expected = base64Encode(new Uint8Array([1, 2, 3, 4]));
    expect(validateCodecReply(okReplyFor(request, expected), request, 4)).toBeNull();
    expect(validateCodecReply({ jobId: "j1", op: "b64chunk", ok: true, result: "AAA=" }, request, 3)).toContain("padding");
    const wrongJob = { jobId: "other", op: "b64chunk", ok: true, result: expected };
    expect(validateCodecReply(wrongJob, request, 4)).toContain("job id");
    expect(validateCodecReply({ jobId: "j1", op: "sha256", ok: true, result: expected }, request, 4)).toContain("op");
    expect(validateCodecReply({ jobId: "j1", op: "b64chunk", ok: true, result: 4 }, request, 4)).toContain("string");
    expect(validateCodecReply({ jobId: "j1", op: "b64chunk", ok: true, result: "AAA" }, request, 4)).toContain("length");
    expect(validateCodecReply({ jobId: "j1", op: "b64chunk", ok: true, result: "AA=A" }, request, 3)).toContain("canonical");
    const shaRequest: CodecRequest = { jobId: "j2", op: "sha256", file };
    expect(validateCodecReply(okReplyFor(shaRequest, "z".repeat(64)), shaRequest, 4)).toContain("malformed");
    expect(validateCodecReply(
      { jobId: "j1", op: "b64chunk", ok: false, error: {} }, request, 4)).toContain("message");
    expect(validateCodecReply("garbage", request, 4)).toContain("object");
  });

  test("base64 replies must have exact padding and zero tail bits for the claimed byte count", () => {
    const b64Request = (byteLength: number): CodecRequest => ({
      jobId: `b${byteLength}`, op: "b64chunk", file: makeFile(Math.max(byteLength, 1)), offset: 0, end: byteLength,
    });
    const check = (result: string, byteLength: number): string | null => {
      const request = b64Request(byteLength);
      return validateCodecReply(okReplyFor(request, result), request, byteLength);
    };

    // byteLength 1: terminal quad MUST be XX== with zero low 4 bits.
    expect(check("AAAA", 1)).toContain("does not match"); // no padding: decodes 3 bytes
    expect(check("AAA=", 1)).toContain("does not match"); // illegal single '=' shape
    expect(check("Zh==", 1)).toContain("bits"); // decodes 1 byte 0x66 but 4 tail bits are 0001
    expect(check("AA==", 1)).toBeNull(); // one zero byte, canonical
    expect(check("Zg==", 1)).toBeNull(); // 0x66 ('f'): g has zero tail bits

    // byteLength 2: terminal quad MUST be XXX= with zero low 2 bits.
    expect(check("AAAA", 2)).toContain("does not match"); // no padding: decodes 3 bytes
    expect(check("Zm==", 2)).toContain("does not match"); // '==' claims a 1-byte remainder
    expect(check("Zm9=", 2)).toContain("bits"); // "fo" data plus 2 tail bits 01
    expect(check("Z===", 2)).toContain("canonical"); // illegal character placement
    expect(check("Zm8=", 2)).toBeNull(); // "fo": 8 has zero low 2 bits

    // byteLength 3 (rem 0): no padding whatsoever.
    expect(check("Zm9=", 3)).toContain("does not match"); // decodes only 2 bytes
    expect(check("Zm9v", 3)).toBeNull(); // "foo", canonical unpadded
    expect(check("AAAA", 3)).toBeNull(); // three zero bytes

    // Length 0 stays the empty string only.
    expect(check("", 0)).toBeNull();
    expect(check("AA==", 0)).toContain("length");
  });

  test("accepts the real core encoder output at 1, 2, 3 and 131072 bytes", async () => {
    const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (const byteLength of [1, 2, 3, 131_072]) {
      const file = makeFile(byteLength, `core-${byteLength}.bin`, byteLength);
      const result = await encodeChunkCore(file, 0, byteLength);
      const request: CodecRequest = {
        jobId: `core-${byteLength}`, op: "b64chunk", file, offset: 0, end: byteLength,
      };
      expect(validateCodecReply(okReplyFor(request, result), request, byteLength)).toBeNull();
      // Structural expectations of the suffix check, independent of content.
      const remainder = byteLength % 3;
      expect(result.endsWith("=")).toBe(remainder !== 0);
      if (remainder === 1) expect(result.endsWith("==")).toBe(true);

      // Flipping one padding tail bit must make the SAME-length string fail
      // even though it still decodes to exactly byteLength bytes.
      if (remainder !== 0) {
        const tailDataIndex = remainder === 1 ? result.length - 3 : result.length - 2;
        const value = B64_ALPHABET.indexOf(result[tailDataIndex]);
        const corrupted = `${result.slice(0, tailDataIndex)}${B64_ALPHABET[value ^ 1]}${result.slice(tailDataIndex + 1)}`;
        expect(corrupted).not.toBe(result);
        expect(validateCodecReply(okReplyFor(request, corrupted), request, byteLength)).toContain("bits");
      }
    }
  });
});

// --- public API through scripted workers ---------------------------------------------

describe("hashAttachmentOffThread with a worker", () => {
  test("returns the validated hex digest and terminates the worker once", async () => {
    const factory = fakeFactory();
    const promise = hashAttachmentOffThread(makeFile(4, "a.bin", 1), undefined, internals(factory));
    await flushTicks();
    const worker = factory.instances[0];
    const request = worker.posted[0];
    expect(request.op).toBe("sha256");
    expect(isCodecRequest(request)).toBe(true);
    worker.emitReply(okReplyFor(request, "a".repeat(64)));
    expect(await promise).toBe("a".repeat(64));
    expect(worker.terminateCount).toBe(1);
    expect(worker.cleanedUp).toBe(true);
  });

  test("rejects malformed replies with cleanup and no fallback hash", async () => {
    const cases: Array<(jobId: string) => unknown> = [
      () => "nope",
      (jobId) => ({ jobId: "wrong", op: "sha256", ok: true, result: "a".repeat(64) }),
      (jobId) => ({ jobId, op: "sha256", ok: true, result: 123 }),
      (jobId) => ({ jobId, op: "sha256", ok: true, result: "Z".repeat(64) }),
      (jobId) => ({ jobId, op: "sha256", ok: false }),
    ];
    for (const makeReply of cases) {
      const factory = fakeFactory();
      const promise = hashAttachmentOffThread(makeFile(4), undefined, internals(factory));
      await flushTicks();
      const worker = factory.instances[0];
      worker.emitReply(makeReply(worker.posted[0].jobId));
      await rejectsWith(promise, (error) => error instanceof ProtocolError && error.code === "internal");
      expect(worker.terminateCount).toBe(1);
      expect(worker.cleanedUp).toBe(true);
    }
  });

  test("surfaces a worker-side failure message with cleanup", async () => {
    const factory = fakeFactory();
    const promise = hashAttachmentOffThread(makeFile(4), undefined, internals(factory));
    await flushTicks();
    const worker = factory.instances[0];
    worker.emitReply({
      jobId: worker.posted[0].jobId, op: "sha256", ok: false,
      error: { name: "Error", message: "slice read failed" },
    });
    await rejectsWith(promise, (error) => error instanceof Error
      && !(error instanceof ProtocolError) && error.message === "slice read failed");
    expect(worker.terminateCount).toBe(1);
    expect(worker.cleanedUp).toBe(true);
  });
});

describe("cooperative fallback", () => {
  test("falls back when Worker is unavailable at construction and hashes correctly", async () => {
    const file = makeFile(64 * KIB, "fb.bin", 3);
    const factory = fakeFactory({ constructorThrow: true });
    expect(await hashAttachmentOffThread(file, undefined, internals(factory))).toBe(await webCryptoDigest(file));
    expect(factory.instances).toHaveLength(0);
  });

  test("falls back after a worker runtime error event, exactly once", async () => {
    const factory = fakeFactory();
    const file = makeFile(64 * KIB, "err.bin", 4);
    const promise = hashAttachmentOffThread(file, undefined, internals(factory));
    await flushTicks();
    const deadWorker = factory.instances[0];
    expect(deadWorker.posted).toHaveLength(1);
    deadWorker.emitError();
    expect(await promise).toBe(await webCryptoDigest(file));
    // The dead worker is terminated and no replacement worker is spawned.
    expect(deadWorker.terminateCount).toBe(1);
    expect(factory.instances).toHaveLength(1);
  });

  test("postMessage failure falls back without leaking the worker", async () => {
    const factory = fakeFactory({ postThrow: true });
    const file = makeFile(32);
    expect(await encodeAttachmentChunk(file, 0, 32, undefined, internals(factory)))
      .toBe(base64Encode(new Uint8Array(await file.arrayBuffer())));
    expect(factory.instances[0].terminateCount).toBe(1);
  });

  test("never falls back after a user abort, even with a crashed worker", async () => {
    const factory = fakeFactory();
    const controller = new AbortController();
    const promise = hashAttachmentOffThread(makeFile(64 * KIB), controller.signal, internals(factory));
    await flushTicks();
    const worker = factory.instances[0];
    controller.abort();
    worker.emitError(); // a racing crash must not trigger fallback work
    await rejectsWith(promise, isAbort);
    expect(worker.terminateCount).toBe(1);
    expect(worker.cleanedUp).toBe(true);
  });

  test("a File read failure during fallback surfaces and is never retried", async () => {
    let reads = 0;
    const badFile = {
      size: 10,
      slice: () => {
        reads += 1;
        return { arrayBuffer: () => Promise.reject(new Error("storage ejected")) };
      },
      arrayBuffer: () => Promise.reject(new Error("storage ejected")),
    } as unknown as File;
    const factory = fakeFactory({ constructorThrow: true });
    await rejectsWith(
      hashAttachmentOffThread(badFile, undefined, internals(factory)),
      (error) => error instanceof Error && error.message === "storage ejected",
    );
    expect(reads).toBe(1); // fallback ran once, no retry loop
  });
});

describe("abort, watchdog and cleanup", () => {
  test("a pre-aborted call rejects before constructing any worker or queuing", async () => {
    const factory = fakeFactory();
    const controller = new AbortController();
    controller.abort();
    await rejectsWith(
      hashAttachmentOffThread(makeFile(4), controller.signal, internals(factory)),
      isAbort,
    );
    expect(factory.instances).toHaveLength(0);
  });

  test("abort while pending terminates the worker and rejects AbortError", async () => {
    const factory = fakeFactory();
    const controller = new AbortController();
    const promise = hashAttachmentOffThread(makeFile(4), controller.signal, internals(factory));
    await flushTicks();
    const worker = factory.instances[0];
    controller.abort();
    await rejectsWith(promise, isAbort);
    expect(worker.terminateCount).toBe(1);
    expect(worker.cleanedUp).toBe(true);
    // A late reply after termination cannot resolve or reject the call again.
    worker.emitReply(okReplyFor(worker.posted[0], "a".repeat(64)));
  });

  test("the watchdog fails a hung worker with an actionable timeout", async () => {
    const factory = fakeFactory();
    const promise = hashAttachmentOffThread(makeFile(4), undefined, internals(factory, 25));
    await flushTicks();
    const worker = factory.instances[0];
    await rejectsWith(promise, (error) => error instanceof ProtocolError && error.code === "timeout");
    expect(worker.terminateCount).toBe(1);
    expect(worker.cleanedUp).toBe(true);
    // Even a later reply is ignored (watchdog already settled the job).
    worker.emitReply(okReplyFor(worker.posted[0], "a".repeat(64)));
  });

  test("public validation rejects unsafe ranges and oversized files as ProtocolErrors", async () => {
    const file = makeFile(10);
    await rejectsWith(encodeAttachmentChunk(file, 0, 11), (e) =>
      e instanceof ProtocolError && e.code === "invalid_argument");
    await rejectsWith(encodeAttachmentChunk(file, -1, 1), (e) =>
      e instanceof ProtocolError && e.code === "invalid_argument");
    await rejectsWith(encodeAttachmentChunk(file, 5, 4), (e) =>
      e instanceof ProtocolError && e.code === "invalid_argument");
    await rejectsWith(encodeAttachmentChunk(file, 0, CODEC_MAX_CHUNK_BYTES + 1), (e) =>
      e instanceof ProtocolError && e.code === "invalid_argument");
    const huge = {
      size: CODEC_MAX_FILE_BYTES + 1,
      slice: () => { throw new Error("never read"); },
    } as unknown as File;
    await rejectsWith(hashAttachmentOffThread(huge), (e) =>
      e instanceof ProtocolError && e.code === "too_large");
  });
});

// --- bounded concurrency pool --------------------------------------------------------

describe("codec worker pool", () => {
  function holdCalls(factory: FakeFactory, count: number): {
    controllers: AbortController[];
    promises: Promise<unknown>[];
  } {
    const controllers: AbortController[] = [];
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < count; i += 1) {
      const controller = new AbortController();
      controllers.push(controller);
      promises.push(hashAttachmentOffThread(
        makeFile(1, `f${i}.bin`), controller.signal, internals(factory, 60_000),
      ).catch((error: unknown) => error));
    }
    return { controllers, promises };
  }

  function releaseOne(factory: FakeFactory, index: number): void {
    const worker = factory.instances[index];
    worker.emitReply(okReplyFor(worker.posted[0], "a".repeat(64)));
  }

  test("runs 4, waits 8, rejects the 13th with backpressure", async () => {
    const factory = fakeFactory();
    const held = holdCalls(factory, CODEC_MAX_ACTIVE_JOBS + CODEC_MAX_WAITING_JOBS);
    try {
      await flushTicks();
      expect(factory.instances).toHaveLength(CODEC_MAX_ACTIVE_JOBS);
      await rejectsWith(
        hashAttachmentOffThread(makeFile(1, "extra.bin"), undefined, internals(factory)),
        (error) => error instanceof ProtocolError && error.code === "backpressure",
      );

      // Finishing one active job hands its slot to the longest waiter (FIFO);
      // the waiting job now constructs its own worker and posts.
      releaseOne(factory, 0);
      await flushTicks(8);
      expect(factory.instances).toHaveLength(CODEC_MAX_ACTIVE_JOBS + 1);
      expect(factory.instances[4].posted[0].file.name).toBe("f4.bin");
    } finally {
      // Drain even when an assertion fails so the shared pool never leaks.
      for (const controller of held.controllers) controller.abort();
      await Promise.all(held.promises);
    }
    for (const worker of factory.instances) {
      expect(worker.terminateCount).toBe(1);
      expect(worker.cleanedUp).toBe(true);
    }
  });

  test("aborting a queued caller frees its waiting slot and keeps FIFO order", async () => {
    const factory = fakeFactory();
    const held = holdCalls(factory, CODEC_MAX_ACTIVE_JOBS + CODEC_MAX_WAITING_JOBS);
    let lateController = new AbortController();
    let late: Promise<unknown> = Promise.resolve();
    try {
      await flushTicks();
      // Waiters are f4..f11; abort f7 (the fourth waiter).
      held.controllers[7].abort();
      const outcome = await held.promises[7];
      expect(isAbort(outcome)).toBe(true);
      // The freed waiting slot accepts one more caller (8 waiters again).
      lateController = new AbortController();
      late = hashAttachmentOffThread(
        makeFile(1, "late.bin"), lateController.signal, internals(factory, 60_000),
      ).catch((error: unknown) => error);

      // Releasing two active slots grants f4 then f5 (the aborted f7 is skipped).
      releaseOne(factory, 0);
      releaseOne(factory, 1);
      await flushTicks(8);
      expect(factory.instances[4].posted[0].file.name).toBe("f4.bin");
      expect(factory.instances[5].posted[0].file.name).toBe("f5.bin");
    } finally {
      lateController.abort();
      for (const controller of held.controllers) controller.abort();
      await Promise.all([...held.promises, late]);
    }
  });
});

// --- real bundled worker (module worker in bun / built worker in vite) ---------------

describe("real module worker", () => {
  test.skipIf(typeof Worker === "undefined")(
    "hashes empty and 5 MiB files and encodes unaligned chunks off thread",
    async () => {
      const empty = makeFile(0, "empty.bin");
      expect(await hashAttachmentOffThread(empty)).toBe(EMPTY_SHA256);

      const five = makeFile(5 * MIB, "five-real.bin", 13);
      expect(await hashAttachmentOffThread(five)).toBe(await webCryptoDigest(five));

      const chunkFile = makeFile(200 * KIB, "chunk-real.bin", 17);
      for (const [offset, end] of [[0, 1], [123, 124], [0, CODEC_MAX_CHUNK_BYTES],
        [200 * KIB - 137, 200 * KIB]] as Array<[number, number]>) {
        const encoded = await encodeAttachmentChunk(chunkFile, offset, end);
        const bytes = new Uint8Array(await chunkFile.slice(offset, end).arrayBuffer());
        expect(encoded).toBe(base64Encode(bytes));
        expect(base64Decode(encoded)).toEqual(bytes);
      }
    },
  );
});
