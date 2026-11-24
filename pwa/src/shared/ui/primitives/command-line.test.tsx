import { happy, resetBoardTestDOM } from "../../../../test-support/dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { CommandLine } from "./command-line";

const labels = { copy: "Copy", copied: "Copied", failed: "Failed" };
const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
// Cause of the whole-suite failure: this file replaces document.execCommand on the shared Happy DOM
// document and never gave it back, so a later file's failed clipboard write fell through to a selection copy that "succeeded".
const execDesc = Object.getOwnPropertyDescriptor(happy.document, "execCommand");
function restoreExecCommand(): void {
  if (execDesc) Object.defineProperty(happy.document, "execCommand", execDesc);
  else delete (happy.document as unknown as { execCommand?: unknown }).execCommand;
}

beforeEach(async () => { await resetBoardTestDOM(); });
afterEach(() => {
  restoreExecCommand();
  unmountReact();
  if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc);
});

async function clickWithoutClipboard(copyResult: boolean): Promise<string> {
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  (happy.document as unknown as { execCommand: () => boolean }).execCommand = () => copyResult;
  renderReact(<CommandLine command="pairfob update" labels={labels} />);
  const button = document.querySelector<HTMLButtonElement>("button")!;
  await act(async () => { button.click(); await Promise.resolve(); });
  return button.textContent ?? "";
}

test("without a Clipboard API a successful copy command shows the copied label", async () => {
  expect(await clickWithoutClipboard(true)).toBe("Copied");
});

test("without a Clipboard API a failing copy command shows the failed label", async () => {
  expect(await clickWithoutClipboard(false)).toBe("Failed");
});
