import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { appRoot } from "../../../app/dom-root";
import { setScreen } from "../../../app/navigation-store";
import { setLang } from "../../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import { ProtocolError } from "../../../lib/protocol/errors";
import type { LiveSession, PairResult } from "../../../lib/protocol/client";
import { setPhase, setSessionTransport } from "../../connection/connection-store";
import { applyCapabilities } from "../../operations/capabilities-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { selectPane, setFullTerminal } from "../session-store";
import { composeDraft, composeLive, setComposeDraft, setComposeLive } from "../compose-store";
import { resetComposeDrafts } from "../drafts/compose-drafts";
import { SessionCompose } from "../guided/session-compose";
import {
  addPickedFiles,
  setAttachmentTransferPort,
  settleTransferQueue,
  startUpload,
} from "./attachments-controller";
import { insertPaths } from "./attachments-insertion";
import { resetAttachmentQueues, attachmentScopeKey, queueSnapshot } from "./attachments-store";
import type {
  AttachmentTransferOptions,
  AttachmentTransferPort,
  UploadStateLike,
} from "./attach-model";

const SCOPE = { daemonId: "d1", paneId: "p1" } as const;
const KEY = attachmentScopeKey(SCOPE);
const COMMITTED_PATH = "/tmp/demo/.pairfob/attachments/abcd1234/notes.txt";

function file(name: string, size: number, type = ""): File {
  return new File([new Uint8Array(size)], name, { type });
}

function committedState(size: number, uploadId = "u1"): UploadStateLike {
  return {
    upload_id: uploadId, state: "committed", offset: size, size,
    sha256: "a".repeat(64), chunk_bytes: 32768, path: COMMITTED_PATH,
  };
}

type Behavior = "commit" | "defer";

type FakePort = AttachmentTransferPort & {
  calls: Array<{ method: string; name?: string }>;
  deferred: () => boolean;
  resolveAll: () => void;
  setBehavior: (behavior: Behavior) => void;
};

function makePort(initial: Behavior = "commit"): FakePort {
  let behavior: Behavior = initial;
  const calls: FakePort["calls"] = [];
  type Pending = { resolve: (state: UploadStateLike) => void; size: number };
  let pending: Pending[] = [];
  const port: AttachmentTransferPort = {
    limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
    async upload(_session, paneId, picked, options?: AttachmentTransferOptions) {
      calls.push({ method: "upload", name: picked.name });
      await options?.onCheckpoint?.({
        uploadId: `u_${picked.name}`, paneId, name: picked.name,
        size: picked.size, sha256: "a".repeat(64), mime: picked.type || "application/octet-stream",
      });
      if (behavior === "defer") {
        return await new Promise<UploadStateLike>((resolve) => {
          pending.push({ resolve, size: picked.size });
        });
      }
      options?.onProgress?.(picked.size, picked.size);
      return committedState(picked.size, `u_${picked.name}`);
    },
    resume: async () => { throw new ProtocolError("forbidden", "not used"); },
    inspect: async () => { throw new ProtocolError("forbidden", "not used"); },
    cancel: async () => { throw new ProtocolError("forbidden", "not used"); },
  };
  return {
    ...port,
    calls,
    deferred: () => pending.length > 0,
    resolveAll: () => { const rest = pending; pending = []; for (const entry of rest) entry.resolve(committedState(entry.size)); },
    setBehavior: (next) => { behavior = next; },
  };
}

let port: FakePort;
const sendingCalls: string[] = [];
const session = {
  isConnected: () => true,
  sendText: async (...args: unknown[]) => { sendingCalls.push(`sendText:${String((args[0] as string)?.slice(0, 40))}`); },
  sendKeys: async (...args: unknown[]) => { sendingCalls.push(`sendKeys:${JSON.stringify(args[0])}`); },
  promptAgent: async (...args: unknown[]) => { sendingCalls.push(`promptAgent:${String(args[0])}`); },
} as unknown as LiveSession;

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("en");
  setPhase("live"); setSessionTransport("p2p");
  setScreen("pane");
  selectPane("p1");
  setFullTerminal(false);
  setCredential({ daemonId: "d1" } as unknown as PairResult);
  attachLiveSession(session);
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, upload_file: true } as never, []);
  resetComposeDrafts();
  resetAttachmentQueues();
  setComposeDraft("");
  sendingCalls.length = 0;
  port = makePort();
  setAttachmentTransferPort(port);
});

afterEach(async () => {
  unmountReact();
  if (port.deferred()) port.resolveAll();
  setAttachmentTransferPort(null);
  attachLiveSession(null);
  setCredential(null);
  setFullTerminal(false);
  resetAttachmentQueues();
  resetComposeDrafts();
  await settleTransferQueue();
  appRoot().replaceChildren();
});

function paintGuided(): HTMLTextAreaElement {
  renderReact(<SessionCompose includeBack={true} />);
  return appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
}

async function settle(): Promise<void> {
  await act(async () => { await settleTransferQueue(); });
}

/** Start an upload and let the serial scheduler actually reach the transfer port. */
async function startJob(id: string): Promise<void> {
  act(() => startUpload(SCOPE, id));
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function uploadOne(name: string, size: number): Promise<string> {
  await act(async () => {
    await addPickedFiles(SCOPE, [file(name, size)]);
  });
  const id = queueSnapshot(KEY)!.items[0].localId;
  act(() => startUpload(SCOPE, id));
  await settle();
  return id;
}

describe("attachment upload and insert flow", () => {
  test("uploads then inserts the absolute path without sending anything, preserving the draft", async () => {
    const textarea = paintGuided();
    await act(async () => {
      textarea.value = "read this";
      textarea.dispatchEvent(new (appRoot().ownerDocument.defaultView!).Event("input", { bubbles: true }));
    });
    const id = await uploadOne("notes.txt", 12);
    expect(queueSnapshot(KEY)?.items[0]).toMatchObject({ status: "committed", path: COMMITTED_PATH });

    await act(async () => { expect(await insertPaths(SCOPE)).toBe(true); });

    expect(textarea.value).toBe(`read this ${COMMITTED_PATH}`);
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(composeDraft()).toBe(textarea.value);
    expect(queueSnapshot(KEY)?.items[0].inserted).toBe(true);
    expect(port.calls.map((call) => call.method)).toEqual(["upload"]);
    expect(sendingCalls).toEqual([]);
    expect(id).toMatch(/^att_/);
  });

  test("insert keeps a selection's surrounding text with real separators and never submits", async () => {
    const textarea = paintGuided();
    await act(async () => {
      textarea.value = "before after";
      textarea.setSelectionRange(6, 6);
      textarea.dispatchEvent(new (appRoot().ownerDocument.defaultView!).Event("input", { bubbles: true }));
    });
    await uploadOne("a.txt", 3);
    await act(async () => { await insertPaths(SCOPE, [queueSnapshot(KEY)!.items[0].localId]); });
    expect(textarea.value).toBe(`before ${COMMITTED_PATH} after`);
    expect(textarea.selectionStart).toBe(6 + 1 + COMMITTED_PATH.length);
    expect(sendingCalls).toEqual([]);
  });

  test("a caret inside a word gets a separator on both sides", async () => {
    const textarea = paintGuided();
    await act(async () => {
      textarea.value = "prefixsuffix";
      textarea.setSelectionRange(6, 6);
      textarea.dispatchEvent(new (appRoot().ownerDocument.defaultView!).Event("input", { bubbles: true }));
    });
    await uploadOne("a.txt", 3);
    await act(async () => { await insertPaths(SCOPE, [queueSnapshot(KEY)!.items[0].localId]); });
    expect(textarea.value).toBe(`prefix ${COMMITTED_PATH} suffix`);
  });

  test("double tap inserts the committed path exactly once", async () => {
    paintGuided();
    await uploadOne("once.txt", 3);
    const id = queueSnapshot(KEY)!.items[0].localId;
    let first = false;
    let second = false;
    await act(async () => {
      const [a, b] = await Promise.all([
        insertPaths(SCOPE, [id]).then((result) => { first = result; }),
        insertPaths(SCOPE, [id]).then((result) => { second = result; }),
      ]);
      void a; void b;
    });
    expect(first === true || second === true).toBe(true);
    expect(first && second).toBe(false);
    const textarea = appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
    expect(textarea.value.split(COMMITTED_PATH)).toHaveLength(2); // exactly one occurrence
    expect(queueSnapshot(KEY)?.items[0].inserted).toBe(true);
    expect(sendingCalls).toEqual([]);
  });

  test("insertion flips live typing to batch and the path is never sent", async () => {
    const textarea = paintGuided();
    await act(async () => setComposeLive(true));
    expect(composeLive()).toBe(true);
    await uploadOne("live.txt", 3);
    await act(async () => { await insertPaths(SCOPE); });
    expect(composeLive()).toBe(false);
    expect(textarea.value).toBe(COMMITTED_PATH);
    expect(sendingCalls).toEqual([]);
  });

  test("a session replacement during the live flush aborts insertion without writing, sending, or marking", async () => {
    paintGuided();
    await act(async () => setComposeLive(true));
    await uploadOne("race.txt", 3);
    const replacement = { isConnected: () => true } as unknown as LiveSession;
    let result = true;
    await act(async () => {
      const pending = insertPaths(SCOPE).then((value) => { result = value; });
      // Replace the session while the live->batch flush is still awaiting: the
      // transition aborts, composeLive stays true, and the insert must refuse
      // the still-live field instead of typing into the PTY.
      attachLiveSession(replacement);
      await pending;
    });
    expect(result).toBe(false);
    expect(composeLive()).toBe(true);
    expect(composeDraft()).toBe("");
    const textarea = appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
    expect(textarea.value).toBe("");
    expect(queueSnapshot(KEY)?.items[0].inserted).toBe(false);
    expect(sendingCalls).toEqual([]);
  });

  test("does not insert when the pane changed and can insert after returning", async () => {
    paintGuided();
    port.setBehavior("defer");
    await act(async () => { await addPickedFiles(SCOPE, [file("roaming.txt", 7)]); });
    const id = queueSnapshot(KEY)!.items[0].localId;
    await startJob(id); // get the transfer in flight before switching panes
    expect(queueSnapshot(KEY)?.items[0].status).toMatch(/preparing|uploading/);

    // Switch panes while the transfer is in flight; it finishes against the
    // captured session and settles its own (original) queue.
    act(() => selectPane("p2"));
    port.resolveAll();
    await settle();
    expect(queueSnapshot(KEY)?.items[0].status).toBe("committed");
    await act(async () => { expect(await insertPaths(SCOPE)).toBe(false); });
    expect(queueSnapshot(KEY)?.notice).toContain("Open this pane");

    act(() => selectPane("p1"));
    await act(async () => { expect(await insertPaths(SCOPE)).toBe(true); });
    const textarea = appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
    expect(textarea.value).toBe(COMMITTED_PATH);
    expect(sendingCalls).toEqual([]);
  });

  test("refuses to truncate a full draft against the exact final assembly", async () => {
    const textarea = paintGuided();
    const longDraft = "x".repeat(32768 - 2);
    await act(async () => {
      textarea.value = longDraft;
      textarea.dispatchEvent(new (appRoot().ownerDocument.defaultView!).Event("input", { bubbles: true }));
    });
    await uploadOne("big-draft.txt", 3);
    await act(async () => { expect(await insertPaths(SCOPE)).toBe(false); });
    expect(textarea.value).toBe(longDraft);
    expect(queueSnapshot(KEY)?.items[0].inserted).toBe(false);
    expect(queueSnapshot(KEY)?.notice).toContain("draft is full");
  });
});