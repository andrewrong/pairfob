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
import { setPhase, setSessionTransport } from "../../connection/connection-store";
import { applyCapabilities } from "../../operations/capabilities-store";
import { attachLiveSession, setCredential } from "../../computers/catalog-store";
import { replaceAgentsFromSnapshot } from "../../dashboard/catalog-store";
import { selectPane, setAgentChat, setFullTerminal } from "../session-store";
import { composeDraft, setComposeDraft, setComposeLive, setComposeIME } from "../compose-store";
import { resetComposeDrafts, switchComposeView } from "../drafts/compose-drafts";
import { FullTerminalCompose } from "../full-terminal/full-terminal-compose-field";
import { AgentCompose } from "../chat/agent-compose";
import { SessionCompose } from "../guided/session-compose";
import {
  addPickedFiles,
  insertPaths,
  setAttachmentTransferPort,
  startAllQueued,
} from "./attachments-controller";
import { resetAttachmentQueues, attachmentScopeKey, queueSnapshot } from "./attachments-store";
import type { AttachmentTransferOptions, AttachmentTransferPort, UploadStateLike } from "./attach-model";

const SCOPE = { daemonId: "d1", paneId: "p1" } as const;
const KEY = attachmentScopeKey(SCOPE);
const PATH_A = "/tmp/demo/.pairfob/attachments/aa/first.txt";
const PATH_B = "/tmp/demo/.pairfob/attachments/bb/second.txt";

const sent: Array<unknown[]> = [];
const session = {
  isConnected: () => true,
  sendText: async (...args: unknown[]) => { sent.push(["sendText", ...args]); },
  sendKeys: async (...args: unknown[]) => { sent.push(["sendKeys", ...args]); },
  promptAgent: async (...args: unknown[]) => { sent.push(["promptAgent", ...args]); },
} as unknown as LiveSession;

function committed(path: string, size: number): UploadStateLike {
  return {
    upload_id: `u_${path}`, state: "committed", offset: size, size,
    sha256: "a".repeat(64), chunk_bytes: 32768, path,
  };
}

beforeEach(async () => {
  await resetBoardTestDOM();
  setLang("en");
  setPhase("live"); setSessionTransport("p2p");
  setScreen("pane");
  setAgentChat(false);
  setFullTerminal(false);
  setComposeLive(false);
  setComposeIME(false);
  selectPane("p1");
  setCredential({ daemonId: "d1" } as unknown as PairResult);
  attachLiveSession(session);
  applyCapabilities({
    ...NO_OPERATION_CAPABILITIES,
    upload_file: true,
    prompt_agent: true,
    history: true,
  } as never, ["codex"]);
  resetComposeDrafts();
  resetAttachmentQueues();
  setComposeDraft("");
  sent.length = 0;
  let counter = 0;
  const paths = [PATH_A, PATH_B];
  const port: AttachmentTransferPort = {
    limits: { maxFileBytes: 20 * 1024 * 1024, maxBatchBytes: 40 * 1024 * 1024, maxFiles: 5 },
    async upload(_s, paneId, file, options?: AttachmentTransferOptions) {
      const index = counter++;
      await options?.onCheckpoint?.({
        uploadId: `u${index}`, paneId, name: file.name, size: file.size,
        sha256: "a".repeat(64), mime: file.type,
      });
      options?.onProgress?.(file.size, file.size);
      return committed(paths[index] ?? PATH_A, file.size);
    },
    resume: async () => { throw new Error("not used"); },
    inspect: async () => { throw new Error("not used"); },
    cancel: async () => { throw new Error("not used"); },
  };
  setAttachmentTransferPort(port);
});

afterEach(() => {
  closeTestDialogs();
  unmountReact();
  setAttachmentTransferPort(null);
  attachLiveSession(null);
  setCredential(null);
  setAgentChat(false);
  setFullTerminal(false);
  resetAttachmentQueues();
  resetComposeDrafts();
  appRoot().replaceChildren();
});

async function commitFiles(names: string[]): Promise<void> {
  await act(async () => {
    await addPickedFiles(SCOPE, names.map((name) => new File([new Uint8Array(3)], name)));
    await startAllQueued(SCOPE);
  });
  for (const item of queueSnapshot(KEY)!.items) {
    expect(item.status).toBe("committed");
  }
}

describe("attachment insertion in all three compose modes", () => {
  test("guided compose field receives the path and nothing is sent", async () => {
    renderReact(<SessionCompose includeBack={true} />);
    const field = appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
    await act(async () => {
      field.value = "question";
      field.dispatchEvent(new (appRoot().ownerDocument.defaultView!.Event)("input", { bubbles: true }));
    });
    expect(composeDraft()).toBe("question");
    expect(sent).toEqual([]);
    await commitFiles(["first.txt"]);
    await act(async () => { await insertPaths(SCOPE); });
    expect(field.value).toBe(`question ${PATH_A}`);
    expect(sent).toEqual([]);
  });

  test("full terminal batch field receives the path and Enter/send are never invoked", async () => {
    const send = (...args: unknown[]) => { sent.push(["composeSend", ...args]); return true; };
    renderReact(<FullTerminalCompose send={send} />);
    const field = appRoot().querySelector<HTMLTextAreaElement>(".full-terminal-compose-input")!;
    expect(field).toBeTruthy();
    await act(async () => {
      field.value = "ls";
      field.dispatchEvent(new (appRoot().ownerDocument.defaultView!.Event)("input", { bubbles: true }));
    });
    expect(composeDraft()).toBe("ls");
    await commitFiles(["first.txt"]);
    await act(async () => { await insertPaths(SCOPE); });
    expect(field.value).toBe(`ls ${PATH_A}`);
    expect(sent).toEqual([]);
  });

  test("agent chat field receives the path and promptAgent is never invoked", async () => {
    replaceAgentsFromSnapshot({
      focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "p1" },
      workspaces: [{ workspace_id: "w1", label: "demo" }],
      tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main" }],
      panes: [{
        pane_id: "p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/tmp/demo",
        agent: "codex", agent_status: "idle", history_available: true,
      }],
    });
    switchComposeView(() => setAgentChat(true));
    renderReact(<AgentCompose />);
    const field = appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
    await act(async () => {
      field.value = "please review";
      field.dispatchEvent(new (appRoot().ownerDocument.defaultView!.Event)("input", { bubbles: true }));
    });
    await commitFiles(["first.txt"]);
    await act(async () => { await insertPaths(SCOPE); });
    expect(field.value).toBe(`please review ${PATH_A}`);
    expect(sent).toEqual([]);
  });

  test("mode switching keeps each mode's draft: insertion lands in full terminal, guided text preserved", async () => {
    renderReact(<SessionCompose includeBack={true} />);
    const guidedField = appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
    await act(async () => {
      guidedField.value = "carry me";
      guidedField.dispatchEvent(new (appRoot().ownerDocument.defaultView!.Event)("input", { bubbles: true }));
    });
    await commitFiles(["first.txt"]);

    switchComposeView(() => setFullTerminal(true));
    unmountReact();
    const send = () => true;
    renderReact(<FullTerminalCompose send={send} />);
    const fullField = appRoot().querySelector<HTMLTextAreaElement>(".full-terminal-compose-input")!;
    // Drafts are mode scoped: the guided text never leaks into the terminal field.
    expect(fullField.value).toBe("");

    await act(async () => { await insertPaths(SCOPE); });
    expect(fullField.value).toBe(PATH_A);

    // Back to guided: its original draft is intact and was never cross-inserted.
    switchComposeView(() => setFullTerminal(false));
    unmountReact();
    renderReact(<SessionCompose includeBack={true} />);
    const backToGuided = appRoot().querySelector<HTMLTextAreaElement>(".dock-form textarea")!;
    expect(backToGuided.value).toBe("carry me");
    expect(sent).toEqual([]);
  });
});
