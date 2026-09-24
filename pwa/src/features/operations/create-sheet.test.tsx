import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { happy, resetBoardTestDOM } from "../../../test-support/dom";
import { closeTestDialogs } from "../../../test-support/close-dialogs";
import { setLang, t } from "../../lib/i18n";
import { loadCreateMemory, type CreateMemory } from "./create-memory";
import { askCreate, NEW_WORKSPACE, type CreateRequest, type CreateSheetInput } from "./create-sheet";

const EMPTY: CreateMemory = { pinned: [], uses: {}, lastUsed: {}, recents: [], dirs: [] };

function input(overrides: Partial<CreateSheetInput> = {}): CreateSheetInput {
  return {
    host: "studio",
    workspaces: [
      { id: "w1", label: "pairfob", path: "~/projects/pairfob" },
      { id: "w2", label: "herdr-web", path: "~/work/herdr-web" },
    ],
    initial: "w2",
    kinds: ["claude", "codex"],
    memory: EMPTY,
    lastKind: "codex",
    canCreateTab: true,
    canCreateWorkspace: true,
    canCreateWorktree: false,
    ...overrides,
  };
}

const settle = async () => {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const sheet = () => document.querySelector<HTMLDialogElement>("dialog.create-sheet")!;

function button(selector: string, text?: string): HTMLButtonElement {
  const found = [...sheet().querySelectorAll<HTMLButtonElement>(selector)]
    .find((node) => text === undefined || node.textContent?.includes(text));
  if (!found) throw new Error(`missing ${selector} ${text ?? ""}: ${sheet().textContent?.slice(0, 200)}`);
  return found;
}

function type(selector: string, value: string): void {
  const field = sheet().querySelector<HTMLInputElement>(selector)!;
  act(() => {
    // Controlled inputs: set through the element's own prototype so React's
    // value tracker sees a change. Under happy-dom React reads a focused text
    // field's change on key events, so focus and follow the input with a keyup.
    field.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    field.dispatchEvent(new happy.Event("input", { bubbles: true }) as unknown as Event);
    field.dispatchEvent(new happy.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
  });
}

/** The sheet's answer, wrapped so awaiting the open does not wait for a submit. */
async function open(options: Partial<CreateSheetInput> = {}): Promise<{ result: Promise<CreateRequest | null> }> {
  let result!: Promise<CreateRequest | null>;
  await act(async () => {
    result = askCreate(input(options));
    await settle();
  });
  return { result };
}

async function submit(): Promise<void> {
  await act(async () => {
    button(".create-submit").click();
    await settle();
  });
}

beforeEach(async () => {
  await resetBoardTestDOM();
  localStorage.clear();
  setLang("zh");
});

afterEach(async () => {
  await act(async () => {
    closeTestDialogs();
    await settle();
  });
});

describe("create sheet", () => {
  test("opens on the entry's workspace with the last kind, says what will happen, and returns a tab", async () => {
    const { result } = await open();
    expect(sheet().querySelector(".modal-title")?.textContent).toBe(t("create.title"));
    expect(button(".create-chip.on").textContent).toBe("herdr-web");
    expect(sheet().querySelector(".create-path")?.textContent).toBe("~/work/herdr-web");
    expect(button(".create-kind.on").textContent).toContain("codex");
    expect(sheet().querySelector(".create-summary")?.textContent).toBe(t("create.summaryTab", { workspace: "herdr-web", kind: "codex" }));
    act(() => button(".create-kind", "claude").click());
    act(() => button(".create-chip", "pairfob").click());
    type(".create-field input", "  review  ");
    await submit();
    expect(await result).toEqual({ kind: "tab", workspaceId: "w1", agentKind: "claude", label: "review" });
  });

  test("a terminal is always offered and carries no agent kind", async () => {
    const { result } = await open();
    act(() => button(".create-kind", t("create.terminal")).click());
    expect(sheet().querySelector(".create-summary")?.textContent).toBe(t("create.summaryTab", { workspace: "herdr-web", kind: t("create.terminal") }));
    await submit();
    expect(await result).toEqual({ kind: "tab", workspaceId: "w2", agentKind: "", label: "" });
  });

  test("a new workspace needs a directory, and a typed path becomes a conversation", async () => {
    const { result } = await open({ memory: { ...EMPTY, dirs: ["~/work/herdr-cli"] } });
    act(() => button(".create-chip", t("create.newWorkspace")).click());
    expect([...sheet().querySelectorAll(".create-dir-path")].map((node) => node.textContent))
      .toEqual(["~/work/herdr-cli", "~/projects/pairfob", "~/work/herdr-web", t("create.dirOther")]);
    await submit();
    expect(sheet().querySelector('[role="alert"]')?.textContent).toBe(t("create.needDir"));
    act(() => button(".create-dir", t("create.dirOther")).click());
    type(".create-dirs input", "~/work/newapp");
    expect(sheet().querySelector(".create-summary")?.textContent).toBe(t("create.summaryWs", { dir: "~/work/newapp", kind: "codex" }));
    await submit();
    expect(await result).toEqual({ kind: "conversation", cwd: "~/work/newapp", agentKind: "codex", label: "" });
  });

  test("choosing an open workspace's directory offers, and creates, a tab there instead", async () => {
    const { result } = await open({ initial: NEW_WORKSPACE });
    act(() => button(".create-dir", "~/projects/pairfob").click());
    expect(sheet().querySelector(".create-hint")?.textContent).toContain(t("create.alreadyOpen", { name: "pairfob" }));
    // The summary names what the button will do, not a new workspace.
    expect(sheet().querySelector(".create-summary")?.textContent).toBe(t("create.summaryTab", { workspace: "pairfob", kind: "codex" }));
    await submit();
    expect(await result).toEqual({ kind: "tab", workspaceId: "w1", agentKind: "codex", label: "" });
  });

  test("a new worktree is offered only with the capability and opens with a terminal", async () => {
    await open({ initial: NEW_WORKSPACE });
    expect(sheet().querySelector(".create-seg")).toBeNull();
    act(closeTestDialogs);
    const { result } = await open({ initial: NEW_WORKSPACE, canCreateWorktree: true });
    act(() => button(".create-dir", "~/projects/pairfob").click());
    act(() => button(".seg-item", t("create.startWorktree")).click());
    expect(sheet().querySelector(".create-kinds")).toBeNull();
    expect(sheet().textContent).toContain(t("create.worktreeTerminal"));
    type('input[placeholder="' + t("create.branchHint") + '"]', "feat/tabs");
    await submit();
    expect(await result).toEqual({ kind: "worktree", cwd: "~/projects/pairfob", branch: "feat/tabs", base: "", label: "" });
  });

  test("without create_tab the sheet only creates workspaces", async () => {
    await open({ canCreateTab: false });
    expect([...sheet().querySelectorAll(".create-chip")].map((node) => node.textContent)).toEqual([t("create.newWorkspace")]);
    expect(button(".create-chip.on").textContent).toBe(t("create.newWorkspace"));
  });

  test("many kinds: four in the grid, the rest behind the full list, where a pick and a pin both stick", async () => {
    const kinds = ["claude", "codex", "gemini", "amp", "goose", "kimi"];
    const { result } = await open({ kinds, lastKind: "claude", memory: { ...EMPTY, uses: { claude: 5, codex: 4, gemini: 2, amp: 1 } } });
    expect([...sheet().querySelectorAll(".create-kind-name")].map((node) => node.textContent))
      .toEqual(["claude", "codex", "gemini", "amp", t("create.terminal"), t("create.all", { n: "6" })]);
    act(() => button(".create-kind.is-all").click());
    expect([...sheet().querySelectorAll(".kind-pick-name")].map((node) => node.textContent))
      .toEqual(["claude", "codex", "gemini", "amp", "goose", "kimi"]);
    act(() => button(".kind-star", undefined).click());
    expect(loadCreateMemory().pinned).toEqual(["claude"]);
    act(() => button(".kind-pick", "kimi").click());
    expect([...sheet().querySelectorAll(".create-kind-name")].slice(0, 4).map((node) => node.textContent))
      .toEqual(["claude", "codex", "gemini", "kimi"]);
    expect(button(".create-kind.on").textContent).toContain("kimi");
    await submit();
    expect((await result as Extract<CreateRequest, { kind: "tab" }>).agentKind).toBe("kimi");
  });
});
