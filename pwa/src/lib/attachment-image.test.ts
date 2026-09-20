import { beforeEach, describe, expect, test } from "bun:test";
import {
  __resetImageInternals,
  __setImageInternals,
  prepareAttachmentImage,
  type ImageWorkerHandle,
} from "./attachment-image.ts";
import {
  validateImageReply,
  type ImageWorkerReply,
  type ImageWorkerRequest,
} from "./attachment-image-protocol.ts";
import { MIN_IMAGE_BYTES, jpegExportName } from "./attachment-image-policy.ts";

const KIB = 1024;
const JPEG_SIG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

type AnyListener = (event: MessageEvent | ErrorEvent) => void;

class FakeWorker {
  terminateCount = 0;
  readonly messageListeners = new Set<(event: MessageEvent) => void>();
  readonly errorListeners = new Set<(event: ErrorEvent) => void>();
  lastMessage: ImageWorkerRequest | undefined;
  constructor(readonly postThrow = false) {}
  postMessage(message: ImageWorkerRequest): void {
    if (this.postThrow) throw new Error("structured clone failed");
    this.lastMessage = message;
  }
  get jobId(): string | undefined {
    return this.lastMessage?.jobId;
  }
  terminate(): void {
    this.terminateCount += 1;
  }
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: string, listener: AnyListener): void {
    (type === "message" ? this.messageListeners : this.errorListeners).add(listener as never);
  }
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: string, listener: AnyListener): void {
    (type === "message" ? this.messageListeners : this.errorListeners).delete(listener as never);
  }
  emitReply(reply: unknown): void {
    for (const listener of [...this.messageListeners]) listener({ data: reply } as MessageEvent);
  }
  emitError(): void {
    for (const listener of [...this.errorListeners]) listener(new ErrorEvent("error"));
  }
  get cleanedUp(): boolean {
    return this.messageListeners.size === 0 && this.errorListeners.size === 0;
  }
}

type FakeFactory = {
  (): ImageWorkerHandle;
  instances: FakeWorker[];
  created: number;
};

function fakeFactory(opts: { postThrow?: boolean; constructorThrow?: boolean } = {}): FakeFactory {
  const factory = (() => {
    if (opts.constructorThrow) throw new Error("Worker blocked by CSP");
    const worker = new FakeWorker(opts.postThrow);
    factory.instances.push(worker);
    factory.created += 1;
    return worker as unknown as ImageWorkerHandle;
  }) as FakeFactory;
  factory.instances = [];
  factory.created = 0;
  return factory;
}

function jpegFile(size: number, name = "photo.jpg"): File {
  const bytes = new Uint8Array(Math.max(size, 3));
  bytes.set(JPEG_SIG.subarray(0, 3), 0);
  return new File([bytes], name, { type: "image/jpeg" });
}

function bigFile(name = "photo.jpg"): File {
  return jpegFile(MIN_IMAGE_BYTES + 4096, name);
}

/** A real JPEG byte blob (valid signature) for a "compressed" reply. */
function jpegBlob(size: number): Blob {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_SIG.subarray(0, 3), 0);
  return new Blob([bytes], { type: "image/jpeg" });
}

function compressedReply(jobId: string, overrides: Partial<Extract<ImageWorkerReply, { kind: "compressed" }>> = {}): ImageWorkerReply {
  return {
    jobId,
    ok: true,
    kind: "compressed",
    blob: jpegBlob(1024),
    mime: "image/jpeg",
    name: "out.jpg",
    width: 800,
    height: 600,
    ...overrides,
  };
}

const isAbort = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { name?: string }).name === "AbortError";

/** Assert a promise rejects with a DOMException named AbortError. */
async function expectAbort(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error("expected the promise to reject");
  } catch (error) {
    expect(isAbort(error)).toBe(true);
  }
}

const cReply = (w: FakeWorker, overrides: Parameters<typeof compressedReply>[1] = {}) =>
  compressedReply(w.jobId ?? "", overrides);
const sReply = (w: FakeWorker, kind: "preserved" | "unsupported" | "not-smaller" | "failed"): ImageWorkerReply =>
  ({ jobId: w.jobId ?? "", ok: true, kind }) as ImageWorkerReply;

const small = (): File => jpegFile(100, "tiny.jpg");

beforeEach(() => {
  // Configuration-only reset. Global queue/slot accounting is NOT repaired:
  // tests must settle every accepted promise and terminate every created
  // worker via normal paths so no live worker leaks across scenarios.
  __resetImageInternals();
});

describe("prepareAttachmentImage — metadata fast path & abort precedence", () => {
  test("small files bypass with reason small and no worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = small();
    const result = await prepareAttachmentImage(file);
    expect(result.reason).toBe("small");
    expect(result.file).toBe(file);
    expect(result.changed).toBe(false);
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("an already-aborted signal rejects even for size-bypassed small input", async () => {
    const controller = new AbortController();
    controller.abort();
    const file = small();
    await expectAbort(prepareAttachmentImage(file, { signal: controller.signal }));
  });

  test("an already-aborted signal rejects for a normal file without creating a worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const controller = new AbortController();
    controller.abort();
    const file = bigFile();
    await expectAbort(prepareAttachmentImage(file, { signal: controller.signal }));
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("known preserved MIME avoids allocating a worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = jpegFile(bigFile().size, "photo.png");
    const png = new File([file], "photo.png", { type: "image/png" });
    const result = await prepareAttachmentImage(png as unknown as File);
    expect(result.reason).toBe("preserved");
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("a screenshot JPEG name is preserved without a worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile("screenshot-01.jpg");
    const result = await prepareAttachmentImage(file);
    expect(result.reason).toBe("preserved");
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("unknown MIME still allocates a worker for byte sniffing", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = new File([bigFile()], "blob.dat", { type: "" });
    const promise = prepareAttachmentImage(file);
    expect(factory.created).toBe(1); // synchronously started
    factory.instances[0].emitReply(sReply(factory.instances[0], "unsupported"));
    const result = await promise;
    expect(result.reason).toBe("unsupported");
    __resetImageInternals();
  });
});

describe("prepareAttachmentImage — concurrency bound (P1)", () => {
  test("two calls keep a single active worker until the first settles", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const p1 = prepareAttachmentImage(bigFile("a.jpg"));
    expect(factory.created).toBe(1); // first starts a worker synchronously
    const p2 = prepareAttachmentImage(bigFile("b.jpg"));
    // Even after the second call, only one worker exists (second is queued).
    expect(factory.created).toBe(1);

    const w1 = factory.instances[0];
    // First replies -> settles -> slot released -> second worker created.
    w1.emitReply(cReply(w1));
    await expect(p1).resolves.toMatchObject({ reason: "compressed" });
    expect(factory.created).toBe(2);
    const w2 = factory.instances[1];
    w2.emitReply(cReply(w2));
    await expect(p2).resolves.toMatchObject({ reason: "compressed" });
    __resetImageInternals();
  });

  test("fill 5 pending then a 6th call falls back to failed without a worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const first = prepareAttachmentImage(bigFile("1.jpg"));
    expect(factory.created).toBe(1);
    const q2 = prepareAttachmentImage(bigFile("2.jpg"));
    const q3 = prepareAttachmentImage(bigFile("3.jpg"));
    const q4 = prepareAttachmentImage(bigFile("4.jpg"));
    const q5 = prepareAttachmentImage(bigFile("5.jpg"));
    expect(factory.created).toBe(1); // all four queued behind the active one

    const sixth = prepareAttachmentImage(bigFile("6.jpg"));
    await expect(sixth).resolves.toMatchObject({ reason: "failed" });
    expect(factory.created).toBe(1); // cap-full never allocated a worker

    // Drain the 5 accepted jobs in order; each new worker is the last created.
    const accepted = [first, q2, q3, q4, q5];
    for (let k = 0; k < accepted.length; k += 1) {
      const w = factory.instances[factory.created - 1];
      w.emitReply(cReply(w));
      await accepted[k];
    }
    __resetImageInternals();
  });

  test("settling (terminating) the active worker releases the queue", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const p1 = prepareAttachmentImage(bigFile("a.jpg"));
    const p2 = prepareAttachmentImage(bigFile("b.jpg"));
    expect(factory.created).toBe(1);
    factory.instances[0].emitError(); // settle the active job (unsupported)
    // Original fallback without a main-thread retry; slot released and p2 starts.
    await p1;
    expect(factory.instances[0].terminateCount).toBeGreaterThan(0);
    expect(factory.created).toBe(2); // slot released -> second worker created
    factory.instances[1].emitError(); // settle the second job
    await p2;
    expect(factory.instances[1].terminateCount).toBeGreaterThan(0);
    __resetImageInternals();
  });

  test("a queued job that times out disappears without allocating a worker and does not wedge later work", async () => {
    const factory = fakeFactory();
    // The active job gets a long injected deadline; two queued jobs get short
    // ones so they expire while still queued.
    __setImageInternals({ createWorker: factory, deadlineMs: 60_000 });
    const first = prepareAttachmentImage(bigFile("1.jpg"));
    expect(factory.created).toBe(1);
    __setImageInternals({ createWorker: factory, deadlineMs: 5 });
    const early = prepareAttachmentImage(bigFile("2.jpg"));
    const later = prepareAttachmentImage(bigFile("3.jpg"));
    expect(factory.created).toBe(1); // queued jobs have no worker yet

    // Both queued jobs expire (failed, no worker). They must vanish from the
    // queue without ever taking the active slot.
    await expect(early).resolves.toMatchObject({ reason: "failed" });
    await expect(later).resolves.toMatchObject({ reason: "failed" });
    expect(factory.created).toBe(1); // expired queued jobs never allocated a worker

    // A fresh job after the expirations must still start normally.
    __setImageInternals({ createWorker: factory, deadlineMs: 60_000 });
    const fresh = prepareAttachmentImage(bigFile("4.jpg"));
    expect(factory.created).toBe(1); // active slot still held by `first`
    const w1 = factory.instances[0];
    w1.emitReply(cReply(w1)); // settle first -> slot released -> fresh starts
    await first;
    expect(factory.created).toBe(2);
    const w2 = factory.instances[1];
    w2.emitReply(cReply(w2));
    await fresh;
    expect(w2.terminateCount).toBeGreaterThan(0);
    __resetImageInternals();
  });
});

describe("prepareAttachmentImage — reply validation (P1)", () => {
  test("valid compressed reply: name from original, mime, lastModified, changed", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile("photo.jpeg");
    const promise = prepareAttachmentImage(file);
    const w = factory.instances[0];
    w.emitReply(cReply(w));
    const result = await promise;
    expect(result.reason).toBe("compressed");
    expect(result.changed).toBe(true);
    expect(result.originalBytes).toBe(file.size);
    expect(result.file.name).toBe(jpegExportName(file.name));
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.lastModified).toBe(file.lastModified);
    expect(w.terminateCount).toBeGreaterThan(0);
    __resetImageInternals();
  });

  test("MIME spoof (not image/jpeg) is treated as malformed -> exact original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    const w = factory.instances[0];
    w.emitReply(cReply(w, { mime: "image/png" }));
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    expect(result.changed).toBe(false);
    __resetImageInternals();
  });

  test("non-JPEG blob bytes are rejected -> exact original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    const pngBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/jpeg" });
    const w = factory.instances[0];
    w.emitReply(cReply(w, { blob: pngBlob }));
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("oversized output dimensions are rejected -> exact original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    const w = factory.instances[0];
    w.emitReply(cReply(w, { width: 4096, height: 4096 }));
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("insufficient gain (blob > 90% input claiming compressed) -> exact original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    factory.instances[0].emitReply(
      cReply(factory.instances[0], { blob: jpegBlob(Math.floor(file.size * 0.95)) }),
    );
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("job id mismatch is rejected -> exact original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    factory.instances[0].emitReply({ ...compressedReply("wrong-id") });
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("a real JPEG-header blob with wrong type (image/png) is rejected -> exact original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    const pngTyped = new Blob([JPEG_SIG], { type: "image/png" }); // JPEG bytes, wrong MIME
    factory.instances[0].emitReply(cReply(factory.instances[0], { blob: pngTyped }));
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("a duck-typed plain object blob is rejected -> exact original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    const fakeBlob = {
      size: 100,
      type: "image/jpeg",
      slice: () => ({ arrayBuffer: async () => JPEG_SIG }),
    } as unknown as Blob; // NOT instanceof Blob
    factory.instances[0].emitReply(cReply(factory.instances[0], { blob: fakeBlob }));
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("abort during async signature validation rejects with AbortError", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const controller = new AbortController();
    const file = bigFile();
    const promise = prepareAttachmentImage(file, { signal: controller.signal });

    // A blob whose arrayBuffer we gate so the signature read stays pending.
    const gate = new Promise<Uint8Array>(() => {});
    const raw = new Blob([JPEG_SIG], { type: "image/jpeg" });
    const gatedBlob = new Proxy(raw, {
      get(target, prop) {
        if (prop === "slice") {
          return () => ({ arrayBuffer: () => gate });
        }
        return Reflect.get(target, prop);
      },
    }) as unknown as Blob;
    factory.instances[0].emitReply(cReply(factory.instances[0], { blob: gatedBlob }));
    controller.abort(); // while the signature read is pending
    await expectAbort(promise);
    __resetImageInternals();
  });

  test("a different-kind (preserved) message while the first signature is pending is ignored", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    const w = factory.instances[0];

    // Gate the first (compressed) signature read so it stays pending; while it
    // is pending a preserved message must be ignored (job.validating).
    let releaseGate!: (bytes: Uint8Array) => void;
    const gate = new Promise<Uint8Array>((resolve) => {
      releaseGate = resolve;
    });
    const raw = new Blob([JPEG_SIG], { type: "image/jpeg" });
    const gatedBlob = new Proxy(raw, {
      get(target, prop) {
        if (prop === "slice") return () => ({ arrayBuffer: () => gate });
        return Reflect.get(target, prop);
      },
    }) as unknown as Blob;
    w.emitReply(cReply(w, { blob: gatedBlob }));
    w.emitReply(sReply(w, "preserved")); // ignored while validating
    releaseGate(JPEG_SIG); // now the first signature read completes
    const result = await promise;
    expect(result.reason).toBe("compressed"); // first message won, not preserved
    expect(result.changed).toBe(true);
    __resetImageInternals();
  });
});

describe("prepareAttachmentImage — reason mapping & fallbacks (P2)", () => {
  test("preserved reply -> preserved", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    factory.instances[0].emitReply(sReply(factory.instances[0], "preserved"));
    const result = await promise;
    expect(result.reason).toBe("preserved");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("unsupported reply -> unsupported", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    factory.instances[0].emitReply(sReply(factory.instances[0], "unsupported"));
    const result = await promise;
    expect(result.reason).toBe("unsupported");
    __resetImageInternals();
  });

  test("not-smaller reply -> not-smaller with original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    factory.instances[0].emitReply(sReply(factory.instances[0], "not-smaller"));
    const result = await promise;
    expect(result.reason).toBe("not-smaller");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("failed reply -> failed with original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    factory.instances[0].emitReply(sReply(factory.instances[0], "failed"));
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("worker error event -> unsupported (no main-thread canvas fallback)", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigFile();
    const promise = prepareAttachmentImage(file);
    factory.instances[0].emitError();
    const result = await promise;
    expect(result.reason).toBe("unsupported");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });

  test("worker constructor throw (unsupported API) -> unsupported, no allocation", async () => {
    const factory = fakeFactory({ constructorThrow: true });
    __setImageInternals({ createWorker: factory });
    const result = await prepareAttachmentImage(bigFile());
    expect(result.reason).toBe("unsupported");
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("deadline (timeout) -> failed with original", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory, deadlineMs: 5 });
    const file = bigFile();
    const promise = prepareAttachmentImage(file); // worker never replies
    const result = await promise;
    expect(result.reason).toBe("failed");
    expect(result.file).toBe(file);
    __resetImageInternals();
  });
});

describe("validateImageReply (protocol)", () => {
  const request: ImageWorkerRequest = { jobId: "req-1", file: bigFile(), photo: false };
  test("accepts a valid compressed reply", () => {
    const reply = compressedReply("req-1", { blob: jpegBlob(100) });
    expect(validateImageReply(reply, request, request.file.size)).toBeNull();
  });
  test("rejects id mismatch", () => {
    const reply = compressedReply("other");
    expect(validateImageReply(reply, request, request.file.size)).toContain("mismatch");
  });
  test("rejects a blob bigger than input", () => {
    const reply = compressedReply("req-1", { blob: jpegBlob(request.file.size + 10) });
    expect(validateImageReply(reply, request, request.file.size)).toContain("bigger");
  });
  test("rejects missing/empty blob", () => {
    const reply = compressedReply("req-1", { blob: new Blob([]) });
    expect(validateImageReply(reply, request, request.file.size)).not.toBeNull();
  });
  test("rejects invalid kind", () => {
    const reply = { jobId: "req-1", ok: true, kind: "bogus" };
    expect(validateImageReply(reply, request, request.file.size)).toContain("kind");
  });
  test("errors carry a message", () => {
    const reply: ImageWorkerReply = { jobId: "req-1", ok: false, error: { name: "E", message: "boom" } };
    expect(validateImageReply(reply, request, request.file.size)).toBeNull();
  });
});