import { resetAttachmentRecovery, setAttachmentJournalBackend } from "./attachments-recovery";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { closeTestDialogs } from "../../../../test-support/close-dialogs";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { appRoot } from "../../../app/dom-root";
import { setScreen } from "../../../app/navigation-store";
import { setLang } from "../../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import type { LiveSession, PairResult } from "../../../lib/protocol/client";
import { setPhase, setSessionTransport, applyOriginConfig } from "../../connection/connection-store";
import { applyCapabilities, clearCapabilities } from "../../operations/capabilities-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { selectPane } from "../session-store";
import { resetComposeDrafts } from "../drafts/compose-drafts";
import { ProtocolError } from "../../../lib/protocol/errors";
import { AttachButton } from "./attach-button";
import { addPickedFiles, setAttachmentTransferPort, settleTransferQueue, startUpload } from "./attachments-controller";
import { patchItem, resetAttachmentQueues, attachmentScopeKey, queueSnapshot, setRuntimeCheckpoint, setPreference } from "./attachments-store";
import { setThumbnailPreparer } from "./attachments-thumbnails";
import type { AttachmentTransferPort, UploadStateLike } from "./attach-model";

const SCOPE = { daemonId: "d1", paneId: "p1" } as const;
const KEY = attachmentScopeKey(SCOPE);

const session = { isConnected: () => true } as unknown as LiveSession;
const port: AttachmentTransferPort = {
  limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
  upload: async () => { throw new Error("not used"); },
  resume: async () => { throw new Error("not used"); },
  inspect: async () => { throw new Error("not used"); },
  cancel: async () => { throw new Error("not used"); },
};

beforeEach(async () => {
  await resetBoardTestDOM();
  resetAttachmentRecovery();
  setAttachmentJournalBackend({ put: async () => {}, list: async () => [], remove: async () => {}, clearDaemon: async () => {} });
  setLang("en");
  setPhase("live");
  setSessionTransport("p2p");
  applyOriginConfig({ protocol: 2, p2p: true });
  setScreen("pane");
  selectPane("p1");
  setCredential({ daemonId: "d1" } as unknown as PairResult);
  attachLiveSession(session);
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, upload_file: true } as never, []);
  resetComposeDrafts();
  resetAttachmentQueues();
  setAttachmentTransferPort(port);
  // Sheet rows render a small generated thumbnail; produce it immediately in
  // tests from a tiny blob (never an object URL of the picked File).
  setThumbnailPreparer(async (file) => new Blob(
    [new Uint8Array([1, 2, 3, 4])],
    { type: file.type === "image/png" ? "image/png" : "image/jpeg" },
  ));
  renderReact(<AttachButton />);
});

afterEach(() => {
  resetAttachmentRecovery();
  setThumbnailPreparer(null);
  closeTestDialogs();
  unmountReact();
  setAttachmentTransferPort(null);
  attachLiveSession(null);
  setCredential(null);
  clearCapabilities();
  resetAttachmentQueues();
  resetComposeDrafts();
  appRoot().replaceChildren();
});

function openSheet(): HTMLElement {
  const button = appRoot().querySelector<HTMLButtonElement>(".attach-btn")!;
  expect(button).toBeTruthy();
  act(() => button.click());
  const sheet = document.querySelector<HTMLElement>(".attach-sheet")!;
  expect(sheet).toBeTruthy();
  return sheet;
}

describe("attach button gating", () => {
  test("is hidden without upload_file and appears once the capability is advertised", () => {
    clearCapabilities();
    renderReact(<AttachButton />);
    expect(appRoot().querySelector(".attach-btn")).toBeNull();
    act(() => applyCapabilities({ ...NO_OPERATION_CAPABILITIES, upload_file: true } as never, []));
    expect(appRoot().querySelector(".attach-btn")).not.toBeNull();
  });

  test("is hidden without a live session", () => {
    attachLiveSession(null);
    act(() => setPhase("connect"));
    expect(appRoot().querySelector(".attach-btn")).toBeNull();
  });
});

describe("attachment sheet", () => {
  test("a first pick rejected by a temporary capability probe shows a visible gate notice", async () => {
    const sheet = openSheet();
    expect(queueSnapshot(KEY)).toBeUndefined(); // nothing exists before the first pick
    // A foreground readiness probe temporarily withdraws upload_file.
    act(() => applyCapabilities({ ...NO_OPERATION_CAPABILITIES } as never, []));
    let uploadAttempts = 0;
    setAttachmentTransferPort({
      limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
      upload: async () => { uploadAttempts += 1; throw new Error("not used"); },
      resume: async () => { throw new Error("not used"); },
      inspect: async () => { throw new Error("not used"); },
      cancel: async () => { throw new Error("not used"); },
    });
    let rejected: unknown = ["sentinel"];
    await act(async () => { rejected = await addPickedFiles(SCOPE, [new File([new Uint8Array(4)], "probe.txt")]); });
    expect(rejected).toEqual([]);
    // Fail-closed: zero rows, zero upload calls, nothing adopted.
    expect(queueSnapshot(KEY)?.items ?? []).toEqual([]);
    expect(uploadAttempts).toBe(0);
    // The rejection is visible and localized: a non-sr-only live region.
    const live = sheet.querySelector<HTMLElement>(".attach-live")!;
    expect(live.classList.contains("sr-only")).toBe(false);
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Reconnect this computer and make sure Pairfob on it is up to date before attaching files.");
    expect(queueSnapshot(KEY)?.notice).toBe(live.textContent);
  }, 8000); // production waitForAttachmentPickReadiness default is 5000ms; keep the test bound above it

  test("offers files, photo library and camera with the right inputs", () => {
    const sheet = openSheet();
    const labels = [...sheet.querySelectorAll<HTMLButtonElement>(".attach-source")].map((b) => b.textContent);
    expect(labels).toContain("Choose file");
    expect(labels).toContain("Photo library");
    expect(labels).toContain("Take photo");
    const files = sheet.querySelector<HTMLInputElement>('input[type=file]');
    expect(files).toBeTruthy();
    const inputs = [...sheet.querySelectorAll<HTMLInputElement>("input[type=file]")];
    expect(inputs.find((input) => input.multiple && input.accept === "*/*")).toBeTruthy();
    expect(inputs.find((input) => input.multiple && input.accept === "image/*")).toBeTruthy();
    const camera = inputs.find((input) => !input.multiple && input.accept === "image/*")!;
    expect(camera.getAttribute("capture")).toBe("environment");
  });

  test("lists queued files with image previews and surfaces limit rejections live", async () => {
    const sheet = openSheet();
    await act(async () => {
      await addPickedFiles(SCOPE, [
        new File([new Uint8Array(4)], "shot.png", { type: "image/png" }),
        new File([new Uint8Array(4)], "notes.txt", { type: "text/plain" }),
      ]);
    });
    const rows = sheet.querySelectorAll(".attach-row");
    expect(rows).toHaveLength(2);
    // The preview is the asynchronously generated thumbnail, not the picked file.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(sheet.querySelector<HTMLImageElement>(".attach-row img")?.src).toContain("blob:");
    expect(sheet.querySelectorAll(".attach-row")).toHaveLength(2);
    const queuedButtons = [...sheet.querySelectorAll<HTMLButtonElement>(".attach-act")].map((b) => b.textContent);
    expect(queuedButtons).toContain("Edit image");
    expect(queuedButtons).toContain("Upload");

    await act(async () => {
      await addPickedFiles(SCOPE, Array.from({ length: 5 }, (_, i) => new File([new Uint8Array(1)], `x${i}.bin`)));
    });
    const live = sheet.querySelector<HTMLElement>(".attach-live")!;
    expect(live.textContent ?? "").toContain("At most 5 files");
    // A nonempty rejection notice is rendered visibly, never pushed to sr-only.
    expect(live.classList.contains("sr-only")).toBe(false);
    expect(sheet.querySelectorAll(".attach-row")).toHaveLength(5);
  });

  test("a per-file size overrun notice renders visibly in the live region", async () => {
    const sheet = openSheet();
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.bin")]);
    });
    const live = sheet.querySelector<HTMLElement>(".attach-live")!;
    expect(live.textContent ?? "").toContain("larger than the");
    expect(live.classList.contains("sr-only")).toBe(false);
    expect(sheet.querySelectorAll(".attach-row")).toHaveLength(0);
  });

  test("a batch overrun notice renders visibly in the live region", async () => {
    const sheet = openSheet();
    // Three 30 MiB JPEG files exceed the 80 MiB LOCAL retained-source batch
    // (each under the 40 MiB per-file JPEG cap) before the 5-file count limit.
    const chunk = new Uint8Array(30 * 1024 * 1024);
    await act(async () => {
      await addPickedFiles(SCOPE, [
        new File(chunk, "a.jpg", { type: "image/jpeg" }),
        new File(chunk, "b.jpg", { type: "image/jpeg" }),
        new File(chunk, "c.jpg", { type: "image/jpeg" }),
      ]);
    });
    const live = sheet.querySelector<HTMLElement>(".attach-live")!;
    expect(live.textContent ?? "").toContain("must stay under");
    expect(live.classList.contains("sr-only")).toBe(false);
    expect(sheet.querySelectorAll(".attach-row")).toHaveLength(2); // only the two that fit
  });

  test("disables sources and inserts when the sheet's pane is no longer open", async () => {
    const sheet = openSheet();
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(4)], "a.txt")]);
    });
    act(() => selectPane("p2"));
    expect(sheet.querySelector(".attach-banner")?.textContent).toContain("different pane");
    const sources = sheet.querySelectorAll<HTMLButtonElement>(".attach-source");
    expect([...sources].every((button) => button.disabled)).toBe(true);
    // Upload and path insertion are blocked off-scope; local remove/edit stay available.
    const actions = [...sheet.querySelectorAll<HTMLButtonElement>(".attach-act")];
    const enabled = actions.filter((button) => !button.disabled).map((button) => button.textContent);
    expect(enabled).not.toContain("Upload");
    expect(enabled).not.toContain("Insert path");
    expect(attachmentScopeKey({ daemonId: "d1", paneId: "p1" })).toBeTruthy();
  });

  // A port that emits a checkpoint, then fails the RPC with the given code.
  function failingPort(code: string): AttachmentTransferPort {
    return {
      limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
      async upload(_s, paneId, file, options) {
        await options?.onCheckpoint?.({
          uploadId: "u1", paneId, name: file.name, size: file.size,
          sha256: "a".repeat(64), mime: file.type || "application/octet-stream",
        });
        throw new ProtocolError(code as never, "boom");
      },
      resume: async () => { throw new Error("n/a"); },
      inspect: async () => { throw new Error("n/a"); },
      cancel: async () => { throw new Error("n/a"); },
    };
  }

  test("an error row with a retained handle offers Check/Cancel, never a fresh Retry", async () => {
    const sheet = openSheet();
    setAttachmentTransferPort(failingPort("forbidden"));
    await act(async () => { await addPickedFiles(SCOPE, [new File([new Uint8Array(4)], "bad.txt")]); });
    const id = queueSnapshot(KEY)!.items[0].localId;
    act(() => startUpload(SCOPE, id));
    await act(async () => { await settleTransferQueue(); });
    const buttons = [...sheet.querySelectorAll<HTMLButtonElement>(".attach-act")].map((b) => b.textContent);
    expect(buttons).toContain("Check status");
    expect(buttons).toContain("Cancel");
    // A fresh Retry would abandon the live handle: never shown.
    expect(buttons).not.toContain("Try again");
  });

  test("a recoverable error row exposes Continue upload, never a fresh Retry", async () => {
    const sheet = openSheet();
    setAttachmentTransferPort(failingPort("unknown_outcome"));
    await act(async () => { await addPickedFiles(SCOPE, [new File([new Uint8Array(4)], "rec.txt")]); });
    const id = queueSnapshot(KEY)!.items[0].localId;
    act(() => startUpload(SCOPE, id));
    await act(async () => { await settleTransferQueue(); });
    const buttons = [...sheet.querySelectorAll<HTMLButtonElement>(".attach-act")].map((b) => b.textContent);
    expect(buttons).toContain("Continue upload");
    expect(buttons).not.toContain("Try again");
  });

  test("uses the shared sheet header, separate scroll body and accessible close button", async () => {
    openSheet();
    const close = document.querySelector<HTMLButtonElement>(".sheet-head > .sheet-close")!;
    expect(close).toBeTruthy();
    expect(close.getAttribute("aria-label")).toBe("Close");
    const form = document.querySelector(".attach-modal > form")!;
    expect([...form.children].map(node => node.className)).toEqual(["sheet-grab", "sheet-head", "sheet-body"]);
    expect(form.querySelector(".sheet-body > .attach-sheet")).toBeTruthy();
    act(() => close.click());
    // Dismiss closes the native modal; the portal unmounts the dialog.
    expect(document.querySelector(".attach-modal")?.open).not.toBe(true);


  });

  // A port that emits a checkpoint and stays pending until the test resolves
  // it, handing back the live progress callback.
  function deferredPort(): {
    port: AttachmentTransferPort;
    progress: () => ((acknowledged: number, total: number) => void) | null;
    resolve: (state: UploadStateLike) => void;
  } {
    let progressFn: ((acknowledged: number, total: number) => void) | null = null;
    let resolveUpload: ((state: UploadStateLike) => void) | null = null;
    const port: AttachmentTransferPort = {
      limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
      async upload(_s, paneId, file, options) {
        await options?.onCheckpoint?.({
          uploadId: "u1", paneId, name: file.name, size: file.size,
          sha256: "a".repeat(64), mime: file.type || "application/octet-stream",
        });
        progressFn = options?.onProgress ?? null;
        return await new Promise<UploadStateLike>((resolve) => { resolveUpload = resolve; });
      },
      resume: async () => { throw new Error("n/a"); },
      inspect: async () => { throw new Error("n/a"); },
      cancel: async () => { throw new Error("n/a"); },
    };
    return {
      port,
      progress: () => progressFn,
      resolve: (state) => resolveUpload?.(state),
    };
  }

  function committedMegabyteState(): UploadStateLike {
    return {
      upload_id: "u1", state: "committed", offset: 1_048_576, size: 1_048_576,
      sha256: "a".repeat(64), chunk_bytes: 131_072,
      path: "/tmp/demo/.pairfob/attachments/abcd/big.bin",
    };
  }

  test("shows acknowledged bytes and measured speed/ETA while uploading, waiting on a stall, and nothing when complete", async () => {
    const sheet = openSheet();
    const deferred = deferredPort();
    setAttachmentTransferPort(deferred.port);
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(1_048_576)], "big.bin")]);
    });
    const id = queueSnapshot(KEY)!.items[0].localId;
    act(() => startUpload(SCOPE, id));
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });

    // First sample: byte count immediately, but no invented speed yet.
    act(() => deferred.progress()?.(524_288, 1_048_576));
    const line = () => sheet.querySelector<HTMLElement>(".attach-rate");
    expect(line()?.textContent).toContain("512 KiB / 1 MiB");
    expect(line()?.textContent ?? "").not.toContain("/s");

    // The controller fills measured rate fields (set directly here to keep UI
    // deterministic; values come from the same pure meter math in production).
    act(() => patchItem(KEY, id, { speedBps: 2 * 1024 * 1024, etaSeconds: 75 }));
    expect(line()?.textContent).toContain("2 MiB/s");
    expect(line()?.textContent).toContain("about 1 min left");

    // Stall: waiting note replaces speed/ETA; byte progress stays visible.
    act(() => patchItem(KEY, id, { waiting: true, speedBps: undefined, etaSeconds: undefined }));
    expect(line()?.textContent).toContain("Waiting for the computer to confirm");
    expect(line()?.textContent ?? "").not.toContain("MiB/s");
    expect(line()?.textContent).toContain("512 KiB / 1 MiB");

    // Completion removes the meter line entirely.
    act(() => deferred.resolve(committedMegabyteState()));
    await act(async () => settleTransferQueue());
    expect(line()).toBeNull();
  });

  test("renders localized zh speed and ETA", async () => {
    setLang("zh");
    const sheet = openSheet();
    const deferred = deferredPort();
    setAttachmentTransferPort(deferred.port);
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(1_048_576)], "zh.bin")]);
    });
    const id = queueSnapshot(KEY)!.items[0].localId;
    act(() => startUpload(SCOPE, id));
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
    act(() => deferred.progress()?.(10_240, 1_048_576));
    act(() => patchItem(KEY, id, { speedBps: 20 * 1024, etaSeconds: 45 }));
    const line = sheet.querySelector<HTMLElement>(".attach-rate")!;
    expect(line.textContent).toContain("20 KiB/秒");
    expect(line.textContent).toContain("约剩余 45 秒");
    act(() => deferred.resolve(committedMegabyteState()));
    await act(async () => settleTransferQueue());
  });

  test("the live speed/ETA and the stall note stay exposed to assistive tech with no aria-live chatter", async () => {
    const sheet = openSheet();
    const deferred = deferredPort();
    setAttachmentTransferPort(deferred.port);
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(1_048_576)], "a11y.bin")]);
    });
    const id = queueSnapshot(KEY)!.items[0].localId;
    act(() => startUpload(SCOPE, id));
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
    act(() => deferred.progress()?.(10_240, 1_048_576));
    act(() => patchItem(KEY, id, { speedBps: 2 * 1024 * 1024, etaSeconds: 75 }));

    // The rate line is plain visible content: no aria-hidden on it or any
    // ancestor, and it is not itself a live region.
    const rateLine = sheet.querySelector<HTMLElement>(".attach-rate")!;
    expect(rateLine).toBeTruthy();
    expect(rateLine.getAttribute("aria-hidden")).toBeNull();
    expect(rateLine.closest('[aria-hidden="true"]')).toBeNull();
    expect(rateLine.closest("[aria-live]")).toBeNull();
    expect(rateLine.textContent).toContain("2 MiB/s");
    expect(rateLine.textContent).toContain("about 1 min left");

    // The stall note gets the same exposure; it still is not a live region.
    act(() => patchItem(KEY, id, { waiting: true, speedBps: undefined, etaSeconds: undefined }));
    const waitingLine = sheet.querySelector<HTMLElement>(".attach-rate")!;
    expect(waitingLine.getAttribute("aria-hidden")).toBeNull();
    expect(waitingLine.closest('[aria-hidden="true"]')).toBeNull();
    expect(waitingLine.closest("[aria-live]")).toBeNull();
    expect(waitingLine.textContent).toContain("Waiting for the computer to confirm");

    // Exactly one polite live region exists in the sheet: the notices line.
    // The meter must never add a second, chatty one.
    expect(sheet.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(sheet.querySelector(".attach-live")?.getAttribute("aria-live")).toBe("polite");

    act(() => deferred.resolve(committedMegabyteState()));
    await act(async () => settleTransferQueue());
  });
});

/** Patch a row with frozen-contract compression fields. */
function patchCompression(id: string, patch: Record<string, unknown>): void {
  act(() => patchItem(KEY, id, patch as never));
}

describe("per-image compression controls", () => {
  async function addImage(name = "photo.png"): Promise<string> {
    const sheet = openSheet();
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(64)], name, { type: "image/png" })]);
    });
    expect(sheet).toBeTruthy();
    return queueSnapshot(KEY)!.items[0].localId;
  }

  test("an idle image row shows an accessible smart/original radio pair defaulting to smart", async () => {
    await addImage();
    // Wait for the generated thumbnail before reading the <img> attributes.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const group = document.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Image compression");
    const radios = [...group.querySelectorAll<HTMLInputElement>("input[type=radio]")];
    expect(radios.map((radio) => radio.nextElementSibling?.textContent)).toEqual(["Smart compress", "Original"]);
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);
    expect(radios.every((radio) => !radio.disabled)).toBe(true);
    expect(radios[0].name).toBe(radios[1].name);
    // The always-valid caption lives OUTSIDE the radiogroup and the group
    // references it via aria-describedby; it is never tied to editNote.
    expect(group.getAttribute("aria-describedby")).toBe(document.querySelector(".attach-mode-caption")?.id);
    expect(document.querySelector(".attach-mode-caption")?.textContent).toBe("Original keeps any edits you made.");
    // Thumbnails decode asynchronously without losing the existing alt.
    const img = document.querySelector<HTMLImageElement>(".attach-row img")!;
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.alt).toBe("");
    // No outcome is claimed before any compression result exists.
    expect(document.querySelector(".attach-compression")).toBeNull();
    // Still exactly one live region in the sheet.
    expect(document.querySelector(".attach-sheet")!.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  test("non-image rows get no mode control and old fixtures without metadata keep working", async () => {
    openSheet();
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(4)], "notes.txt", { type: "text/plain" })]);
    });
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(document.querySelectorAll(".attach-row")).toHaveLength(1);
  });

  test("renders localized zh labels", async () => {
    setLang("zh");
    await addImage();
    const group = document.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("图片压缩");
    const texts = [...group.querySelectorAll("span")].map((span) => span.textContent);
    expect(texts).toEqual(["智能压缩", "原图"]);
    expect(group.getAttribute("aria-describedby")).toBe(document.querySelector(".attach-mode-caption")?.id);
    expect(document.querySelector(".attach-mode-caption")?.textContent).toBe("原图会保留已做的编辑。");
  });

  test("selecting Original invokes the store preference for that row only", async () => {
    const id = await addImage();
    const radios = [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")];
    act(() => radios[1].click());
    // Round-trip through the real store: only this row's mode flips.
    expect(queueSnapshot(KEY)!.items[0].compressionMode).toBe("original");
    expect(radios[1].checked).toBe(true);
    act(() => radios[0].click());
    expect(queueSnapshot(KEY)!.items[0].compressionMode).toBe("smart");
    // The store rejects unsafe rows; a direct call proves the guard.
    setRuntimeCheckpoint(KEY, id, {
      uploadId: "u1", paneId: "p1", name: "photo.png", size: 64,
      sha256: "a".repeat(64), mime: "image/png",
    });
    expect(setPreference(KEY, id, "original")).toBe(false);
  });

  test("a row with a retained runtime checkpoint freezes the mode even while idle", async () => {
    const id = await addImage();
    // Runtime checkpoints never publish snapshots; the row re-renders on the
    // accompanying item patch (as in production), so set the checkpoint first.
    setRuntimeCheckpoint(KEY, id, {
      uploadId: "u1", paneId: "p1", name: "photo.png", size: 64,
      sha256: "a".repeat(64), mime: "image/png",
    });
    act(() => patchItem(KEY, id, { status: "error", errorText: "x" }));
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    expect(radios.every((radio) => radio.disabled)).toBe(true);
  });

  test("active, cancelling, committed and cancelIntent rows freeze the mode", async () => {
    const id = await addImage();
    for (const status of ["preparing", "uploading", "cancelling", "committed"] as const) {
      patchCompression(id, { status });
      expect([...document.querySelectorAll<HTMLInputElement>('input[type=radio]')].every((radio) => radio.disabled))
        .toBe(true);
    }
    patchCompression(id, { status: "error", errorText: "boom", cancelIntent: true });
    expect([...document.querySelectorAll<HTMLInputElement>('input[type=radio]')].every((radio) => radio.disabled)).toBe(true);
    // An idle error without cancel intent stays changeable.
    patchCompression(id, { status: "error", errorText: "boom", cancelIntent: false });
    expect([...document.querySelectorAll<HTMLInputElement>('input[type=radio]')].some((radio) => !radio.disabled)).toBe(true);
  });

  test("shows the compressing note only while compressing and preparing", async () => {
    const id = await addImage();
    patchCompression(id, { status: "preparing", compressing: true });
    expect(document.querySelector(".attach-compression")?.textContent).toBe("Compressing image…");
    patchCompression(id, { status: "queued", compressing: true });
    expect(document.querySelector(".attach-compression")).toBeNull();
    setLang("zh");
    patchCompression(id, { status: "preparing", compressing: true });
    expect(document.querySelector(".attach-compression")?.textContent).toBe("正在压缩图片…");
  });

  test("exact metadata examples: real saved percentage only when changed", async () => {
    const id = await addImage();
    // A real result: 8 MiB -> 2 MiB is a real 75% saving, claimed once.
    patchCompression(id, {
      compressionMode: "smart", compressing: false, originalBytes: 8 * 1024 * 1024,
      size: 2 * 1024 * 1024, compressionReason: "compressed", compressionChanged: true,
    });
    const saved = document.querySelector(".attach-compression")!;
    expect(saved.textContent).toBe("8 MiB → 2 MiB · saved 75%");
    // Floor, never round up to a false 100%: 1 byte remaining out of 100.
    patchCompression(id, {
      originalBytes: 100, size: 1, compressionReason: "compressed", compressionChanged: true,
    });
    expect(document.querySelector(".attach-compression")?.textContent).toBe("100 B → 1 B · saved 99%");
    // Sub-percent remainders keep one floored decimal, capped at 99.9%.
    patchCompression(id, {
      originalBytes: 100_000, size: 500, compressionReason: "compressed", compressionChanged: true,
    });
    expect(document.querySelector(".attach-compression")?.textContent)
      .toBe("97.7 KiB → 500 B · saved 99.5%");
    patchCompression(id, {
      originalBytes: 10_000_000, size: 1, compressionReason: "compressed", compressionChanged: true,
    });
    expect(document.querySelector(".attach-compression")?.textContent).toContain("saved 99.9%");
    // Preserve/fallback reasons state the original was kept and claim nothing.
    patchCompression(id, { size: 8 * 1024 * 1024, compressionReason: "preserved", compressionChanged: false });
    expect(document.querySelector(".attach-compression")?.textContent)
      .toBe("Your edits are kept and the image uploads uncompressed.");
    patchCompression(id, { compressionReason: "not-smaller", compressionChanged: false });
    expect(document.querySelector(".attach-compression")?.textContent)
      .toBe("Compression would not make it smaller; the original was kept.");
    patchCompression(id, { compressionReason: "failed", compressionChanged: false });
    expect(document.querySelector(".attach-compression")?.textContent)
      .toBe("Compression failed; the original was kept.");
    // Never claim gains from a changed-but-absent baseline.
    patchCompression(id, { compressionReason: "compressed", compressionChanged: true, originalBytes: undefined });
    expect(document.querySelector(".attach-compression")?.textContent).toBe("Original size kept");
  });

  test("capacity counts raw source bytes, progress still uses item.size", async () => {
    const id = await addImage();
    patchCompression(id, {
      originalBytes: 30 * 1024 * 1024, size: 2 * 1024 * 1024,
      status: "uploading", acknowledged: 1024 * 1024,
    });
    const capacity = document.querySelector(".attach-capacity")!;
    expect(capacity.textContent).toContain("30 MiB of 80 MiB");
    const progress = document.querySelector<HTMLProgressElement>(".attach-progress")!;
    expect(progress.max).toBe(2 * 1024 * 1024);
    expect(progress.value).toBe(1024 * 1024);
  });

  test("mode options keep ≥44px touch height and the pair may shrink/wrap at 390px", async () => {
    const scss = await Bun.file(new URL("../../../styles/attachments.scss", import.meta.url).pathname).text();
    const rule = scss.slice(scss.indexOf(".attach-mode-option {"), scss.indexOf(".attach-mode-option input"));
    expect(rule).toContain("min-height: 44px");
    const groupRule = scss.slice(scss.indexOf(".attach-mode {"), scss.indexOf(".attach-mode-option {"));
    expect(groupRule).toContain("flex-wrap: wrap");
    expect(groupRule).toContain("max-width: 100%");
  });
});

describe("per-image rendering intent select", () => {
  async function addImage(name = "photo.png"): Promise<string> {
    openSheet();
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(64)], name, { type: "image/png" })]);
    });
    return queueSnapshot(KEY)!.items[0].localId;
  }

  function changeIntent(value: string): void {
    const select = document.querySelector<HTMLSelectElement>(".attach-intent-select")!;
    expect(select).toBeTruthy();
    act(() => {
      select.value = value;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  }

  test("an idle image row shows a native select, photo default, zh labels, no detail caption for photo", async () => {
    setLang("zh");
    await addImage();
    const select = document.querySelector<HTMLSelectElement>(".attach-intent-select")!;
    expect(select.getAttribute("aria-label")).toBe("图片用途");
    expect([...select.options].map((option) => option.textContent)).toEqual(["照片", "文字与细节"]);
    expect(select.value).toBe("photo");
    expect(select.disabled).toBe(false);
    // The detail caption renders ONLY when the intent is detail.
    expect(document.querySelector(".attach-intent-caption")?.textContent).toBe("");
    setLang("en");
  });

  test("selecting detail invokes setImageIntent and shows the localized caption", async () => {
    const id = await addImage();
    changeIntent("detail");
    expect(queueSnapshot(KEY)!.items[0].imageIntent).toBe("detail");
    expect(document.querySelector<HTMLSelectElement>(".attach-intent-select")!.value).toBe("detail");
    expect(document.querySelector(".attach-intent-caption")?.textContent)
      .toBe("Preserves original clarity for text, screenshots and fine detail.");
    changeIntent("photo");
    expect(queueSnapshot(KEY)!.items[0].imageIntent).toBe("photo");
    expect(document.querySelector(".attach-intent-caption")?.textContent).toBe("");
    expect(id).toBeTruthy();
  });

  test("scheduled and frozen rows disable the intent select", async () => {
    const id = await addImage();
    const select = () => document.querySelector<HTMLSelectElement>(".attach-intent-select")!;
    act(() => patchItem(KEY, id, { scheduled: true }));
    expect(select().disabled).toBe(true);
    act(() => patchItem(KEY, id, { scheduled: false, cancelIntent: true }));
    expect(select().disabled).toBe(true);
    act(() => patchItem(KEY, id, { cancelIntent: false, status: "uploading" }));
    expect(select().disabled).toBe(true);
    act(() => patchItem(KEY, id, { status: "queued" }));
    expect(select().disabled).toBe(false);
  });

  test("non-image rows get no intent select", async () => {
    openSheet();
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(4)], "notes.txt", { type: "text/plain" })]);
    });
    expect(document.querySelector(".attach-intent-select")).toBeNull();
  });
});

describe("transfer phases and diagnostics", () => {
  async function addRow(name = "a.bin"): Promise<string> {
    openSheet();
    await act(async () => {
      await addPickedFiles(SCOPE, [new File([new Uint8Array(16)], name)]);
    });
    return queueSnapshot(KEY)!.items[0].localId;
  }

  test("a scheduled queued row says Queued, waiting; explicit phases label the live stage", async () => {
    const id = await addRow();
    const status = () => document.querySelector(".attach-status")!.textContent;
    act(() => patchItem(KEY, id, { scheduled: true }));
    expect(status()).toBe("Queued, waiting");
    setLang("zh");
    // Language change does not republish already-rendered markup; touch the
    // row so React re-renders it while it stays scheduled.
    act(() => patchItem(KEY, id, { scheduled: true, originalBytes: 16 }));
    expect(status()).toBe("排队等待");
    // An explicit phase names the live stage instead of the generic status.
    act(() => patchItem(KEY, id, { scheduled: false, transferPhase: "sending" }));
    expect(status()).toBe("发送中…");
    setLang("en");
    act(() => patchItem(KEY, id, { transferPhase: "hashing" }));
    expect(status()).toBe("Hashing…");
    for (const [phase, label] of [["begin", "Starting upload…"], ["commit", "Confirming save…"], ["status", "Checking status…"]] as const) {
      act(() => patchItem(KEY, id, { transferPhase: phase }));
      expect(status()).toBe(label);
    }
    act(() => patchItem(KEY, id, { transferPhase: "compressing" }));
    expect(status()).toBe("Compressing image…");
  });

  test("restored note and persistence warning render when present, hidden otherwise", async () => {
    const id = await addRow();
    expect(document.querySelector(".attach-restored")).toBeNull();
    expect(document.querySelector(".attach-persist-warn")).toBeNull();
    act(() => patchItem(KEY, id, { restored: true, persistenceWarning: "Queue restored without files." }));
    expect(document.querySelector(".attach-restored")?.textContent).toBe("Restored from an earlier session.");
    expect(document.querySelector(".attach-persist-warn")?.textContent).toBe("Queue restored without files.");
  });

  test("details show real numeric ms and source/upload bytes; transport only while the scope is current", async () => {
    const id = await addRow();
    // No details element at all when stageTimings does not exist.
    expect(document.querySelector(".attach-details")).toBeNull();
    act(() => patchItem(KEY, id, {
      stageTimings: { hashing: 12, begin: 3, sending: 450.5, commit: 9, status: 21 },
      originalBytes: 4096,
    }));
    const rows = [...document.querySelectorAll(".attach-stages li")].map((li) => li.textContent);
    expect(rows).toEqual([
      "Hashing: 12 ms",
      "Begin: 3 ms",
      "Sending: 450.5 ms",
      "Commit: 9 ms",
      "Status: 21 ms",
      "Source 4 KiB · Upload 16 B",
      // The current connection is labeled explicitly (never a bare route claim)
      // because no transferTransport was captured on this row.
      "Current connection: Direct",
    ]);
    // Off-scope: real diagnostics stay, but the live current-connection line is
    // dropped (never an inferred route). No default private paths appear.
    act(() => selectPane("p2"));
    const offScope = [...document.querySelectorAll(".attach-stages li")].map((li) => li.textContent);
    expect(offScope.some((row) => row.includes("Current connection:"))).toBe(false);
    expect(offScope.join(" ")).not.toMatch(/\/Users\/|\/home\/|\/private\//);
    act(() => selectPane("p1"));
    expect(document.querySelector(".attach-stages")!.textContent).toContain("Current connection:");
  });

  test("diagnostics round display noise and omit invalid durations", async () => {
    const id = await addRow();
    act(() => patchItem(KEY, id, {
      stageTimings: { hashing: 12.400000035, sending: NaN, begin: Infinity, commit: -1 },
    }));
    const text = document.querySelector(".attach-stages")!.textContent;
    expect(text).toContain("Hashing: 12.4 ms");
    expect(text).not.toMatch(/NaN|Infinity|Sending:|Begin:|Commit:/);
  });

  test("zh details use the localized stage labels and transport line", async () => {
    const id = await addRow();
    setLang("zh");
    act(() => patchItem(KEY, id, { stageTimings: { sending: 100 } }));
    const rows = [...document.querySelectorAll(".attach-stages li")].map((li) => li.textContent);
    expect(rows[0]).toBe("发送：100 ms");
    expect(rows.some((row) => row.startsWith("当前连接："))).toBe(true);
    setLang("en");
  });
});


test("Relay blocks uploads and resume; P2P route changes update the open sheet", async () => {
  const sheet = openSheet();
  await addPickedFiles(SCOPE, [new File(["data"], "p2p-only.txt")]);
  act(() => setSessionTransport("relay"));
  const uploadAll = () => [...sheet.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Upload all")!;
  expect(uploadAll().disabled).toBe(true);
  expect(sheet.textContent).toContain("File uploads require a P2P connection");
  expect(sheet.querySelector<HTMLButtonElement>(".attach-source")!.disabled).toBe(false);
  act(() => setSessionTransport("p2p"));
  expect(uploadAll().disabled).toBe(false);
  expect(sheet.textContent).not.toContain("File uploads require a P2P connection");
  const id = queueSnapshot(KEY)!.items[0].localId;
  act(() => { patchItem(KEY, id, { status: "error", recoverable: true }); setSessionTransport("relay"); });
  const resume = [...sheet.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Continue upload")!;
  expect(resume.disabled).toBe(true);
});
