import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { unmountReact } from "../../../../test-support/react-harness";
import { setScreen } from "../../../app/navigation-store";
import { setLang } from "../../../lib/i18n";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import type { LiveSession, PairResult } from "../../../lib/protocol/client";
import { setPhase, setSessionTransport } from "../../connection/connection-store";
import { applyCapabilities } from "../../operations/capabilities-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { selectPane, setFullTerminal } from "../session-store";
import { setComposeDraft } from "../compose-store";
import { resetComposeDrafts } from "../drafts/compose-drafts";
import {
  addPickedFiles,
  setAttachmentTransferPort,
  settleTransferQueue,
} from "./attachments-controller";
import {
  resetAttachmentQueues,
  attachmentScopeKey,
  queueSnapshot,
} from "./attachments-store";
import type { AttachmentTransferPort } from "./attach-model";

const SCOPE = { daemonId: "d1", paneId: "p1" } as const;
const KEY = attachmentScopeKey(SCOPE);

const session = {
  isConnected: () => true,
  sendText: async () => {},
  sendKeys: async () => {},
  promptAgent: async () => {},
} as unknown as LiveSession;

function file(name: string, size: number, type = ""): File {
  return new File([new Uint8Array(size)], name, { type });
}

const port: AttachmentTransferPort = {
  limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
  async upload() {
    throw new Error("no upload should occur during picking");
  },
  async resume() {
    throw new Error("no resume should occur during picking");
  },
  async inspect() {
    throw new Error("no inspect should occur during picking");
  },
  async cancel() {
    throw new Error("no cancel should occur during picking");
  },
};

const GRANT = { ...NO_OPERATION_CAPABILITIES, upload_file: true } as never;

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("en");
  setPhase("live"); setSessionTransport("p2p");
  setScreen("pane");
  selectPane("p1");
  setFullTerminal(false);
  setCredential({ daemonId: "d1" } as unknown as PairResult);
  attachLiveSession(session);
  // Start with the upload grant ABSENT, as during refreshHerdConfig focus-return.
  applyCapabilities({ ...NO_OPERATION_CAPABILITIES, upload_file: false } as never, []);
  resetComposeDrafts();
  resetAttachmentQueues();
  setComposeDraft("");
  setAttachmentTransferPort(port);
});

afterEach(async () => {
  unmountReact();
  setAttachmentTransferPort(null);
  attachLiveSession(null);
  setCredential(null);
  setFullTerminal(false);
  resetAttachmentQueues();
  resetComposeDrafts();
  await settleTransferQueue();
});

describe("pick readiness across a capability recovery gap", () => {
  test("a pick whose grant lands after 10ms adopts the file exactly once", async () => {
    await act(async () => {
      const pending = addPickedFiles(SCOPE, [file("a.txt", 1)]);
      setTimeout(() => applyCapabilities(GRANT, []), 10);
      await pending;
    });
    expect(queueSnapshot(KEY)?.items).toHaveLength(1);
    expect(queueSnapshot(KEY)?.items[0].name).toBe("a.txt");
  });

  test("a pick whose pane changes before the grant is never adopted", async () => {
    await act(async () => {
      const pending = addPickedFiles(SCOPE, [file("b.txt", 1)]);
      // The owner moved away while the picker returned focus.
      selectPane("p2");
      // Late-grant scenario: keep the grant in play so it cannot leak a timer
      // into later tests if `pending` resolves false and the test would end
      // early. The grant promise is awaited alongside the pick.
      const grantPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          applyCapabilities(GRANT, []);
          resolve();
        }, 10);
      });
      await Promise.all([pending, grantPromise]);
    });
    expect(queueSnapshot(KEY)?.items ?? []).toHaveLength(0);
  });

  test("two concurrent picks of the same name+size are both adopted as distinct files", async () => {
    // Each pick builds a fresh File object; name+size alone cannot establish
    // identity, so both land after the recovery gap.
    await act(async () => {
      const first = addPickedFiles(SCOPE, [file("dup.txt", 1)]);
      const second = addPickedFiles(SCOPE, [file("dup.txt", 1)]);
      setTimeout(() => applyCapabilities(GRANT, []), 10);
      const [a, b] = await Promise.all([first, second]);
      expect(a).toEqual([]);
      expect(b).toEqual([]);
    });
    expect(queueSnapshot(KEY)?.items).toHaveLength(2);
    expect(queueSnapshot(KEY)?.items.map((row) => row.name)).toEqual(["dup.txt", "dup.txt"]);
  });

  test("the same File object picked twice across the recovery gap is deduplicated", async () => {
    const picked = file("once.txt", 1);
    await act(async () => {
      const first = addPickedFiles(SCOPE, [picked]);
      const second = addPickedFiles(SCOPE, [picked]);
      setTimeout(() => applyCapabilities(GRANT, []), 10);
      await Promise.all([first, second]);
    });
    expect(queueSnapshot(KEY)?.items).toHaveLength(1);
  });
});