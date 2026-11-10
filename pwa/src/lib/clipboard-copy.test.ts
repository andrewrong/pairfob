import { happy, resetChatDOM } from "../../test-support/chat-dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyText } from "./clipboard-copy";

type Doc = { execCommand?: unknown };
const doc = () => happy.document as unknown as Doc;
let calls: string[];
let recorded: string[];
const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function setClipboard(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: value }, configurable: true, writable: true });
}
function installCommand(impl: () => boolean): void {
  doc().execCommand = (cmd: string) => {
    calls.push(cmd);
    recorded.push((happy.document.body.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "");
    return impl();
  };
}

beforeEach(async () => {
  await resetChatDOM();
  calls = [];
  recorded = [];
});
afterEach(() => {
  if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

test("without a Clipboard API the textarea copy runs synchronously", async () => {
  setClipboard(undefined);
  installCommand(() => true);
  const pending = copyText("a\nb");
  expect(calls).toEqual(["copy"]);
  expect(await pending).toBe(true);
  expect(calls).toEqual(["copy"]);
  expect(recorded).toEqual(["a\nb"]);
  expect(happy.document.body.querySelector("textarea")).toBeNull();
});

test("a rejected clipboard write falls back to the textarea copy", async () => {
  setClipboard({ writeText: () => Promise.reject(new Error("denied")) });
  installCommand(() => true);
  expect(await copyText("x")).toBe(true);
  expect(calls).toEqual(["copy"]);
  expect(recorded).toEqual(["x"]);
});

test("a resolved clipboard write does not use the copy command", async () => {
  setClipboard({ writeText: () => Promise.resolve() });
  installCommand(() => true);
  expect(await copyText("x")).toBe(true);
  expect(calls).toEqual([]);
});

test("both paths failing returns false and leaves no textarea", async () => {
  for (const impl of [() => false, () => { throw new Error("no"); }]) {
    setClipboard({ writeText: () => Promise.reject(new Error("denied")) });
    installCommand(impl);
    expect(await copyText("x")).toBe(false);
    expect(happy.document.body.querySelector("textarea")).toBeNull();
  }
});
