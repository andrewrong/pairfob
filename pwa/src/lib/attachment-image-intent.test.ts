/**
 * Focused tests for the attachment-image `intent` option and the compressed
 * result dimensions. Covers only this patch:
 * - intent:'detail' returns the exact source File with reason 'preserved',
 *   never allocating a worker, for a normally-compressible large JPEG and for
 *   a trusted (photo) PNG that would otherwise reach the worker;
 * - an already-aborted signal still rejects before the detail bypass;
 * - a validated 'compressed' reply propagates width/height to the result.
 *
 * Uses the same host-side fake-worker seam as attachment-image.test.ts; no
 * real Worker is constructed.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  __resetImageInternals,
  __setImageInternals,
  prepareAttachmentImage,
  type ImageWorkerHandle,
} from "./attachment-image.ts";
import type { ImageWorkerReply, ImageWorkerRequest } from "./attachment-image-protocol.ts";
import { MIN_IMAGE_BYTES } from "./attachment-image-policy.ts";

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

/** Large JPEG: without the detail bypass this input always reaches a worker. */
function bigJpeg(name = "photo.jpg"): File {
  return fileWithSignature(MIN_IMAGE_BYTES + 4096, JPEG_SIG, name, "image/jpeg");
}

/** Large trusted PNG (photo:true): also worker-eligible without detail. */
function bigPng(name = "photo.png"): File {
  return fileWithSignature(MIN_IMAGE_BYTES + 4096, PNG_SIG, name, "image/png");
}

function jpegBlob(size: number): Blob {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_SIG.subarray(0, 3), 0);
  return new Blob([bytes], { type: "image/jpeg" });
}

function compressedReply(jobId: string): ImageWorkerReply {
  return {
    jobId,
    ok: true,
    kind: "compressed",
    blob: jpegBlob(1024),
    mime: "image/jpeg",
    name: "out.jpg",
    width: 1024,
    height: 768,
  };
}

const isAbort = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { name?: string }).name === "AbortError";

beforeEach(() => {
  __resetImageInternals();
});

describe("prepareAttachmentImage — intent detail bypass", () => {
  test("detail JPEG returns the exact source File, preserved, with no worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigJpeg();
    const result = await prepareAttachmentImage(file, { intent: "detail" });
    expect(result.file).toBe(file); // exact source, same object
    expect(result.reason).toBe("preserved");
    expect(result.changed).toBe(false);
    expect(result.originalBytes).toBe(file.size);
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("detail PNG (even trusted photo PNG) returns the exact source with no worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigPng();
    // photo:true would make this PNG worker-eligible; detail still wins.
    const result = await prepareAttachmentImage(file, { intent: "detail", photo: true });
    expect(result.file).toBe(file);
    expect(result.reason).toBe("preserved");
    expect(result.changed).toBe(false);
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("detail does not skip the small/abort precedence: already-aborted rejects", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const controller = new AbortController();
    controller.abort();
    const file = bigJpeg();
    await expect(
      prepareAttachmentImage(file, { intent: "detail", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("an abort listener firing later is still an AbortError for detail input shape", async () => {
    // Sanity: the rejection really is an AbortError DOMException, not a result.
    const controller = new AbortController();
    controller.abort();
    try {
      await prepareAttachmentImage(bigJpeg(), { intent: "detail", signal: controller.signal });
      throw new Error("expected rejection");
    } catch (error) {
      expect(isAbort(error)).toBe(true);
    }
  });

  test("intent photo must not grant PNG provenance: arbitrary PNG stays preserved/no worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigPng();
    const result = await prepareAttachmentImage(file, { intent: "photo" });
    expect(result.reason).toBe("preserved");
    expect(result.file).toBe(file);
    expect(result.changed).toBe(false);
    expect(factory.created).toBe(0);
    __resetImageInternals();
  });

  test("explicit photo:true still routes a large PNG to the worker", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigPng();
    const promise = prepareAttachmentImage(file, { photo: true });
    expect(factory.created).toBe(1);
    factory.instances[0].emitReply({
      jobId: factory.instances[0].jobId ?? "",
      ok: true,
      kind: "preserved",
    });
    const result = await promise;
    expect(result.reason).toBe("preserved");
    expect(factory.instances[0].terminateCount).toBeGreaterThan(0);
    __resetImageInternals();
  });

  test("intent photo on JPEG uses the ordinary compression queue (worker request task image)", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const promise = prepareAttachmentImage(bigJpeg(), { intent: "photo" });
    expect(factory.created).toBe(1);
    expect(factory.instances[0].lastMessage?.task ?? "image").toBe("image");
    expect(factory.instances[0].lastMessage?.photo).toBe(false);
    factory.instances[0].emitReply({
      jobId: factory.instances[0].jobId ?? "",
      ok: true,
      kind: "preserved",
    });
    await promise;
    __resetImageInternals();
  });
});

describe("prepareAttachmentImage — compressed result dimensions", () => {
  test("validated compressed reply propagates actual width/height", async () => {
    const factory = fakeFactory();
    __setImageInternals({ createWorker: factory });
    const file = bigJpeg("holiday.jpeg");
    const promise = prepareAttachmentImage(file);
    expect(factory.created).toBe(1);
    const worker = factory.instances[0];
    worker.emitReply(compressedReply(worker.jobId ?? ""));
    const result = await promise;
    expect(result.reason).toBe("compressed");
    expect(result.changed).toBe(true);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
    expect(worker.terminateCount).toBeGreaterThan(0);
    __resetImageInternals();
  });
});
