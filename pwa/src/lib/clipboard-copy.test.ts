import { happy, resetChatDOM } from "../../test-support/chat-dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyText } from "./clipboard-copy";

type Doc = { execCommand?: unknown };
const doc = () => happy.document as unknown as Doc;
const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");

type Seen = {
  tag: string;
  editable: string;
  firstChildIsText: boolean;
  firstChildData: string;
  selected: string;
  whiteSpace: string;
  userSelect: string;
  clipboard: Record<string, string>;
};
let calls: string[];
let seen: Seen[];

function setClipboard(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: value }, configurable: true, writable: true });
}

// Stub of the copy command: records the node holding the selection at the moment it runs, then fires a copy event.
function installCommand(impl: () => boolean): void {
  doc().execCommand = (cmd: string) => {
    calls.push(cmd);
    const selection = happy.window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const node = range?.commonAncestorContainer ?? null;
    const el = (node && node.nodeType === 3 ? node.parentElement : node) as HTMLElement | null;
    const clipboard: Record<string, string> = {};
    const event = new happy.window.Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (type: string, data: string) => { clipboard[type] = data; } },
    });
    happy.document.dispatchEvent(event);
    const first = el?.firstChild ?? null;
    const style = el ? happy.window.getComputedStyle(el) : null;
    seen.push({
      tag: el?.tagName.toLowerCase() ?? "",
      editable: el?.contentEditable ?? "",
      firstChildIsText: first?.nodeType === 3,
      firstChildData: (first as Text | null)?.data ?? "",
      selected: selection?.toString() ?? "",
      whiteSpace: style?.whiteSpace ?? "",
      userSelect: style?.userSelect ?? "",
      clipboard,
    });
    return impl();
  };
}

beforeEach(async () => {
  await resetChatDOM();
  calls = [];
  seen = [];
});
afterEach(() => {
  if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

test("without a Clipboard API the selection copy runs synchronously from a contenteditable span holding a text node", async () => {
  setClipboard(undefined);
  installCommand(() => true);
  const pending = copyText("a\nb");
  expect(calls).toEqual(["copy"]);
  expect(await pending).toBe(true);
  expect(calls).toEqual(["copy"]);
  const s = seen[0]!;
  expect(s.tag).not.toBe("textarea");
  expect(s.tag).not.toBe("input");
  expect(s.tag).toBe("span");
  expect(s.editable).toBe("true");
  expect(s.firstChildIsText).toBe(true);
  expect(s.firstChildData).toBe("a\nb");
  expect(s.selected).toBe("a\nb");
});

test("the selection span keeps newlines and stays selectable", async () => {
  setClipboard(undefined);
  installCommand(() => true);
  await copyText("a\nb");
  expect(seen[0]!.whiteSpace).toBe("pre");
  expect(seen[0]!.userSelect).toBe("text");
});

test("a copy event during the command receives the text as text/plain", async () => {
  setClipboard(undefined);
  installCommand(() => true);
  await copyText("a\nb");
  expect(seen[0]!.clipboard).toEqual({ "text/plain": "a\nb" });
});

test("the result follows the copy command and nothing is left behind", async () => {
  const cases: [() => boolean, boolean][] = [
    [() => true, true],
    [() => false, false],
    [() => { throw new Error("no"); }, false],
  ];
  for (const [impl, want] of cases) {
    setClipboard(undefined);
    installCommand(impl);
    expect(await copyText("x")).toBe(want);
    expect(happy.document.body.querySelector("[contenteditable]")).toBeNull();
    expect(happy.document.body.textContent).not.toContain("x");
    expect(happy.window.getSelection()?.rangeCount).toBe(0);
  }
});

test("a rejected clipboard write falls back to the selection copy", async () => {
  setClipboard({ writeText: () => Promise.reject(new Error("denied")) });
  installCommand(() => true);
  expect(await copyText("x")).toBe(true);
  expect(calls).toEqual(["copy"]);
  expect(seen[0]!.firstChildData).toBe("x");
});

test("a resolved clipboard write does not use the copy command", async () => {
  setClipboard({ writeText: () => Promise.resolve() });
  installCommand(() => true);
  expect(await copyText("x")).toBe(true);
  expect(calls).toEqual([]);
});
