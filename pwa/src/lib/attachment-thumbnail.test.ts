/**
 * Thumbnail stage tests for the SHARED attachment-image queue.
 *
 * Uses the same host-side fake-worker callback seam as attachment-image.test
 * (no real Worker, no main-thread canvas) plus pure policy checks for the
 * PNG static scan. Covers: host fast gates, validated/malformed worker
 * replies, abort/deadline slot release, overflow -> null, and the critical
 * invariant that image and thumbnail jobs are NEVER run concurrently
 * (1 active + 4 queued, shared across both tasks).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  IMAGE_DEADLINE_MS,
  THUMBNAIL_DEADLINE_MS,
  __resetImageInternals,
  __setImageInternals,
  prepareAttachmentImage,
  prepareAttachmentThumbnail,
  type ImageWorkerHandle,
} from "./attachment-image.ts";
import type { ImageWorkerReply, ImageWorkerRequest } from "./attachment-image-protocol.ts";
import {
  MIN_IMAGE_BYTES,
  THUMBNAIL_MAX_INPUT_BYTES,
  pngIsStatic,
} from "./attachment-image-policy.ts";

const JPEG_SIG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type AnyListener = (event: MessageEvent | ErrorEvent) => void;

class FakeWorker {
  terminateCount = 0;
  readonly messageListeners = new Set<(event: MessageEvent) => void>();
  readonly errorListeners = new Set<(event: ErrorEvent) => void>();
  lastMessage: ImageWorkerRequest | undefined;
  postMessage(message: ImageWorkerRequest): void {
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
}

type FakeFactory = {
  (): ImageWorkerHandle;
  instances: FakeWorker[];
  created: number;
};

function fakeFactory(): FakeFactory {
  const factory = (() => {
    const worker = new FakeWorker();
    factory.instances.push(worker);
    factory.created += 1;
    return worker as unknown as ImageWorkerHandle;
  }) as FakeFactory;
  factory.instances = [];
  factory.created = 0;
  return factory;
}

function fileWithSignature(size: number, signature: Uint8Array, name: string, type: string): File {
  const bytes = new Uint8Array(Math.max(size, signature.length));
  bytes.set(signature, 0);
  return new File([bytes], name, { type });
}

const thumbJpeg = (name = "photo.jpg"): File =>
  fileWithSignature(80 * 1024, JPEG_SIG, name, "image/jpeg");
const thumbPng = (name = "photo.png"): File =>
  fileWithSignature(80 * 1024, PNG_SIG, name, "image/png");
const bigJpeg = (name = "photo.jpg"): File =>
  fileWithSignature(MIN_IMAGE_BYTES + 4096, JPEG_SIG, name, "image/jpeg");

function signedBlob(signature: Uint8Array, size: number, type: string): Blob {
  const bytes = new Uint8Array(Math.max(size, signature.length));
  bytes.set(signature, 0);
  return new Blob([bytes], { type });
}

type ThumbReply = Extract<ImageWorkerReply, { kind: "thumbnail" }>;

function thumbnailReply(
  jobId: string,
  overrides: Partial<ThumbReply> = {},
): ImageWorkerReply {
  return {
    jobId,
    ok: true,
    kind: "thumbnail",
    blob: signedBlob(JPEG_SIG, 4096, "image/jpeg"),
    mime: "image/jpeg",
    width: 128,
    height: 96,
    ...overrides,
  };
}

function compressedReply(jobId: string): ImageWorkerReply {
  return {
    jobId,
    ok: true,
    kind: "compressed",
    blob: signedBlob(JPEG_SIG, 1024, "image/jpeg"),
    mime: "image/jpeg",
    name: "out.jpg",
    width: 800,
    height: 600,
  };
}

const isAbort = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { name?: string }).name === "AbortError";

async function expectAbort(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error("expected the promise to reject");
  } catch (error) {
    expect(isAbort(error)).toBe(true);
  }
}

/** Settle the newest worker with a task-correct successful reply. */
async function settleNewest(factory: FakeFactory, promises: Promise<unknown>[]): Promise<void> {
  const worker = factory.instances[factory.created - 1];
  const task = worker.lastMessage?.task ?? "image";
  worker.emitReply(task === "thumbnail" ? thumbnailReply(worker.jobId ?? "") : compressedReply(worker.jobId ?? ""));
  await promises.shift();
}

beforeEach(() => {
  __resetImageInternals();
});

describe("prepareAttachmentThumbnail — constants", () => {
  test("thumbnail deadline is 10s and image deadline 20s", () => {
    expect(THUMBNAIL_DEADLINE_MS).toBe(10_000);
    expect(IMAGE_DEADLINE_MS).toBe(20_000);
  });
});

describe("prepareAttachmentThumbnail — host fast gate", () => {
  test("confident unsupported MIME (gif) -> null with no worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = new File([new Uint8Array(10_000)], "anim.gif", { type: "image/gif" });
    await expect(prepareAttachmentThumbnail(file)).resolves.toBeNull();
    expect(factory.created).toBe(0);
  });

  test("confident unsupported MIME (webp) -> null with no worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = new File([new Uint8Array(10_000)], "pic.webp", { type: "image/webp" });
    await expect(prepareAttachmentThumbnail(file)).resolves.toBeNull();
    expect(factory.created).toBe(0);
  });

  test("over 40 MiB -> null with no worker, even for image/jpeg", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = new File([new Uint8Array(THUMBNAIL_MAX_INPUT_BYTES + 1)], "big.jpg", {
      type: "image/jpeg",
    });
    await expect(prepareAttachmentThumbnail(file)).resolves.toBeNull();
    expect(factory.created).toBe(0);
  });

  test("exactly 40 MiB passes the size boundary and enqueues", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = new File([new Uint8Array(THUMBNAIL_MAX_INPUT_BYTES)], "edge.jpg", {
      type: "image/jpeg",
    });
    const promise = prepareAttachmentThumbnail(file);
    expect(factory.created).toBe(1);
    factory.instances[0].emitReply(thumbnailReply(factory.instances[0].jobId ?? ""));
    await expect(promise).resolves.toBeInstanceOf(Blob);
  });

  test("empty/unknown MIME is byte-sniffed in the worker (unsupported reply -> null)", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "blob.dat", { type: "" });
    const promise = prepareAttachmentThumbnail(file);
    expect(factory.created).toBe(1); // not fast-rejected: worker does the sniff
    factory.instances[0].emitReply({
      jobId: factory.instances[0].jobId ?? "",
      ok: true,
      kind: "unsupported",
    });
    await expect(promise).resolves.toBeNull();
  });

  test("already-aborted signal rejects even for an oversized/unsupported input", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const controller = new AbortController();
    controller.abort();
    const file = new File([new Uint8Array(THUMBNAIL_MAX_INPUT_BYTES + 1)], "big.gif", {
      type: "image/gif",
    });
    await expectAbort(prepareAttachmentThumbnail(file, { signal: controller.signal }));
    expect(factory.created).toBe(0);
  });
});

describe("prepareAttachmentThumbnail — worker request shape", () => {
  test("posts task thumbnail with photo false", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbPng());
    const worker = factory.instances[0];
    expect(worker.lastMessage?.task).toBe("thumbnail");
    expect(worker.lastMessage?.photo).toBe(false);
    worker.emitReply(
      thumbnailReply(worker.jobId ?? "", {
        blob: signedBlob(PNG_SIG, 4096, "image/png"),
        mime: "image/png",
      }),
    );
    await promise;
  });
});

describe("prepareAttachmentThumbnail — valid host validation", () => {
  test("valid JPEG thumbnail reply returns the exact worker Blob", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbJpeg());
    const worker = factory.instances[0];
    const blob = signedBlob(JPEG_SIG, 2048, "image/jpeg");
    worker.emitReply(thumbnailReply(worker.jobId ?? "", { blob, width: 128, height: 72 }));
    const result = await promise;
    expect(result).toBe(blob);
    expect(result?.type).toBe("image/jpeg");
    expect(worker.terminateCount).toBeGreaterThan(0);
  });

  test("valid 128x128 PNG thumbnail reply returns the Blob", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbPng());
    const worker = factory.instances[0];
    const blob = signedBlob(PNG_SIG, 3000, "image/png");
    worker.emitReply(
      thumbnailReply(worker.jobId ?? "", { blob, mime: "image/png", width: 128, height: 128 }),
    );
    const result = await promise;
    expect(result).toBe(blob);
    expect(result?.type).toBe("image/png");
  });
});

describe("prepareAttachmentThumbnail — malformed / failed replies -> null", () => {
  test("job id mismatch -> null", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbJpeg());
    factory.instances[0].emitReply(thumbnailReply("wrong-id"));
    await expect(promise).resolves.toBeNull();
    expect(factory.instances[0].terminateCount).toBeGreaterThan(0);
  });

  test("blob type disagrees with mime -> null", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbJpeg());
    factory.instances[0].emitReply(
      thumbnailReply(factory.instances[0].jobId ?? "", {
        blob: signedBlob(JPEG_SIG, 2048, "image/png"),
        mime: "image/jpeg",
      }),
    );
    await expect(promise).resolves.toBeNull();
  });

  test("dimension 129 exceeds the bound -> null", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbJpeg());
    factory.instances[0].emitReply(
      thumbnailReply(factory.instances[0].jobId ?? "", { width: 129, height: 72 }),
    );
    await expect(promise).resolves.toBeNull();
  });

  test("blob larger than 128 KiB -> null", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbJpeg());
    factory.instances[0].emitReply(
      thumbnailReply(factory.instances[0].jobId ?? "", {
        blob: signedBlob(JPEG_SIG, 128 * 1024 + 1, "image/jpeg"),
      }),
    );
    await expect(promise).resolves.toBeNull();
  });

  test("claimed PNG mime with real JPEG bytes -> null (async signature gate)", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbPng());
    factory.instances[0].emitReply(
      thumbnailReply(factory.instances[0].jobId ?? "", {
        blob: signedBlob(JPEG_SIG, 2048, "image/png"),
        mime: "image/png",
      }),
    );
    await expect(promise).resolves.toBeNull();
  });

  test("simple failure kinds all resolve null", async () => {
    const kinds = ["failed", "unsupported", "not-smaller", "preserved"] as const;
    for (const kind of kinds) {
      const factory = fakeFactory();
      __setImageInternals({ createWorker: factory });
      const promise = prepareAttachmentThumbnail(thumbJpeg(`${kind}.jpg`));
      factory.instances[0].emitReply({
        jobId: factory.instances[0].jobId ?? "",
        ok: true,
        kind,
      });
      // eslint-disable-next-line no-await-in-loop
      await expect(promise).resolves.toBeNull();
      __resetImageInternals();
    }
  });

  test("error (ok:false) reply -> null", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbJpeg());
    factory.instances[0].emitReply({
      jobId: factory.instances[0].jobId ?? "",
      ok: false,
      error: { name: "Error", message: "boom" },
    });
    await expect(promise).resolves.toBeNull();
  });

  test("worker error event -> null", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentThumbnail(thumbJpeg());
    factory.instances[0].emitError();
    await expect(promise).resolves.toBeNull();
  });

  test("worker constructor throw -> null, no instance", async () => {
    const throwingFactory = (() => {
      throw new Error("Worker blocked");
    }) as FakeFactory;
    throwingFactory.instances = [];
    throwingFactory.created = 0;
    __setImageInternals({ createWorker: throwingFactory });
    await expect(prepareAttachmentThumbnail(thumbJpeg())).resolves.toBeNull();
    expect(throwingFactory.created).toBe(0);
  });
});

describe("prepareAttachmentThumbnail — shared queue with image tasks", () => {
  test("an image and a thumbnail never run concurrently (queued thumbnail starts after image)", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const imagePromise = prepareAttachmentImage(bigJpeg("a.jpg"));
    expect(factory.created).toBe(1); // image starts immediately
    const thumbPromise = prepareAttachmentThumbnail(thumbJpeg("a-thumb.jpg"));
    expect(factory.created).toBe(1); // thumbnail waits behind the image

    const w1 = factory.instances[0];
    expect(w1.lastMessage?.task ?? "image").toBe("image");
    w1.emitReply(compressedReply(w1.jobId ?? ""));
    const imageResult = await imagePromise;
    expect(imageResult.reason).toBe("compressed");

    expect(factory.created).toBe(2); // slot released -> thumbnail worker created
    const w2 = factory.instances[1];
    expect(w2.lastMessage?.task).toBe("thumbnail");
    w2.emitReply(thumbnailReply(w2.jobId ?? ""));
    await expect(thumbPromise).resolves.toBeInstanceOf(Blob);
    expect(w2.terminateCount).toBeGreaterThan(0);
  });

  test("thumbnail active then queued image + queued thumbnail drain strictly one at a time", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promises: Promise<unknown>[] = [
      prepareAttachmentThumbnail(thumbJpeg("t1.jpg")),
      prepareAttachmentImage(bigJpeg("i1.jpg")),
      prepareAttachmentThumbnail(thumbPng("t2.png")),
    ];
    expect(factory.created).toBe(1); // only the thumbnail is active
    expect(factory.instances[0].lastMessage?.task).toBe("thumbnail");

    const w1 = factory.instances[0];
    w1.emitReply(thumbnailReply(w1.jobId ?? ""));
    await promises[0];
    expect(factory.created).toBe(2);
    const w2 = factory.instances[1];
    expect(w2.lastMessage?.task ?? "image").toBe("image");
    w2.emitReply(compressedReply(w2.jobId ?? ""));
    await promises[1];
    expect(factory.created).toBe(3);
    const w3 = factory.instances[2];
    expect(w3.lastMessage?.task).toBe("thumbnail");
    w3.emitReply(
      thumbnailReply(w3.jobId ?? "", {
        blob: signedBlob(PNG_SIG, 2000, "image/png"),
        mime: "image/png",
      }),
    );
    await promises[2];
    // Never more than one worker existed at any instant.
    expect(factory.created).toBe(3);
    expect(factory.instances.every((w) => w.terminateCount === 1)).toBe(true);
  });

  test("cap full (1 active + 4 queued, mixed tasks) -> next thumbnail null, next image failed", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const accepted: Promise<unknown>[] = [prepareAttachmentImage(bigJpeg("1.jpg"))];
    expect(factory.created).toBe(1);
    accepted.push(prepareAttachmentImage(bigJpeg("2.jpg")));
    accepted.push(prepareAttachmentThumbnail(thumbJpeg("3.jpg")));
    accepted.push(prepareAttachmentImage(bigJpeg("4.jpg")));
    accepted.push(prepareAttachmentThumbnail(thumbPng("5.png")));
    expect(factory.created).toBe(1); // four queued, one active

    await expect(prepareAttachmentThumbnail(thumbJpeg("6.jpg"))).resolves.toBeNull();
    const overflowImage = await prepareAttachmentImage(bigJpeg("7.jpg"));
    expect(overflowImage.reason).toBe("failed");
    expect(factory.created).toBe(1); // neither overflow call allocated

    // Drain the five accepted jobs in FIFO order.
    await settleNewest(factory, accepted);
    await settleNewest(factory, accepted);
    await settleNewest(factory, accepted);
    await settleNewest(factory, accepted);
    await settleNewest(factory, accepted);
    expect(accepted).toHaveLength(0);
    expect(factory.created).toBe(5);
  });

  test("aborting a queued thumbnail removes it and does not wedge the queue", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const imagePromise = prepareAttachmentImage(bigJpeg("a.jpg"));
    expect(factory.created).toBe(1);
    const controller = new AbortController();
    const thumbPromise = prepareAttachmentThumbnail(thumbJpeg("a-thumb.jpg"), {
      signal: controller.signal,
    });
    expect(factory.created).toBe(1);
    controller.abort();
    await expectAbort(thumbPromise);
    expect(factory.created).toBe(1); // aborted queued job never got a worker

    const w1 = factory.instances[0];
    w1.emitReply(compressedReply(w1.jobId ?? ""));
    await imagePromise;

    // Queue is usable immediately afterwards.
    const after = prepareAttachmentThumbnail(thumbJpeg("b-thumb.jpg"));
    expect(factory.created).toBe(2);
    const w2 = factory.instances[1];
    w2.emitReply(thumbnailReply(w2.jobId ?? ""));
    await expect(after).resolves.toBeInstanceOf(Blob);
  });

  test("thumbnail deadline frees the active slot for later work", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory, deadlineMs: 5 });
    const timedOut = prepareAttachmentThumbnail(thumbJpeg("slow.jpg")); // never replies
    await expect(timedOut).resolves.toBeNull();

    // Slot was released: a fresh image starts a worker at once.
    __setImageInternals({ createWorker: factory, deadlineMs: 60_000 });
    const imagePromise = prepareAttachmentImage(bigJpeg("after.jpg"));
    expect(factory.created).toBe(2);
    const w2 = factory.instances[1];
    w2.emitReply(compressedReply(w2.jobId ?? ""));
    const result = await imagePromise;
    expect(result.reason).toBe("compressed");
    expect(w2.terminateCount).toBeGreaterThan(0);
  });

  test("queued thumbnail deadline expiry never allocates a worker and the active job still drains", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory, deadlineMs: 60_000 });
    const active = prepareAttachmentImage(bigJpeg("hold.jpg"));
    expect(factory.created).toBe(1);
    __setImageInternals({ createWorker: factory, deadlineMs: 5 });
    const queuedThumb = prepareAttachmentThumbnail(thumbJpeg("queued.jpg"));
    const queuedImage = prepareAttachmentImage(bigJpeg("queued2.jpg"));
    await expect(queuedThumb).resolves.toBeNull();
    await expect(queuedImage).resolves.toMatchObject({ reason: "failed" });
    expect(factory.created).toBe(1); // expired queued jobs never started

    __setImageInternals({ createWorker: factory, deadlineMs: 60_000 });
    const w1 = factory.instances[0];
    w1.emitReply(compressedReply(w1.jobId ?? ""));
    await active;
  });
});

describe("pngIsStatic — APNG / truncation policy", () => {
  /** Build a PNG chunk: length(4 BE) + type(4 ASCII) + data + CRC(4, ignored). */
  function chunk(type: string, data: number[]): number[] {
    const length = data.length;
    return [
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
      ...type.split("").map((c) => c.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0,
    ];
  }
  const ihdr = chunk("IHDR", new Array(13).fill(0));
  const actl = chunk("acTL", [0, 0, 0, 1, 0, 0, 0, 0]);
  const idat = chunk("IDAT", []);

  test("IDAT before any acTL -> static true", () => {
    const header = new Uint8Array([...PNG_SIG, ...ihdr, ...idat]);
    expect(pngIsStatic(header)).toBe(true);
  });

  test("acTL before the first IDAT -> animated (false)", () => {
    const header = new Uint8Array([...PNG_SIG, ...ihdr, ...actl, ...idat]);
    expect(pngIsStatic(header)).toBe(false);
  });

  test("scan ending inside a non-IDAT chunk before the first IDAT -> null (no guess)", () => {
    // Declare a tEXt chunk longer than the bytes we include, then cut the
    // scan before IDAT: static-ness is undetermined.
    const text = chunk("tEXt", new Array(64).fill(0x41));
    const full = new Uint8Array([...PNG_SIG, ...ihdr, ...text, ...idat]);
    const cut = full.subarray(0, PNG_SIG.length + ihdr.length + 20);
    expect(pngIsStatic(cut)).toBeNull();
  });

  test("IDAT chunk header visible even with huge declared data -> static true", () => {
    // IDAT length is declared as 1,000,000 but only the 8-byte chunk header
    // is present in the scan; the type is known, so the PNG is static.
    const hugeIdat = [0, 0x0f, 0x42, 0x40, ..."IDAT".split("").map((c) => c.charCodeAt(0))];
    const header = new Uint8Array([...PNG_SIG, ...ihdr, ...hugeIdat]);
    expect(pngIsStatic(header)).toBe(true);
  });
});
