import { happy, resetChatDOM } from "../../../../test-support/chat-dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { clearNotice, visibleNotice } from "../../../app/notices-store";
import { setLang, t } from "../../../lib/i18n";
import { copyAgentReply } from "./agent-chat-controller";

const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");

beforeEach(async () => {
  await resetChatDOM();
  setLang("en");
  clearNotice();
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
});
afterEach(() => {
  clearNotice();
  if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc);
});

function command(result: boolean): void {
  (happy.document as unknown as { execCommand: unknown }).execCommand = () => result;
}

test("a reply copied through the selection fallback shows the copied status", async () => {
  command(true);
  await copyAgentReply("reply");
  expect(visibleNotice()).toMatchObject({ text: t("chat.copiedReply"), tone: "status" });
});

test("a reply that no path can copy shows the copy-denied error only", async () => {
  command(false);
  await copyAgentReply("reply");
  expect(visibleNotice()).toMatchObject({ text: "The browser did not allow copy.", tone: "error" });
});
