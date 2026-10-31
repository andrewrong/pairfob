import { resetTestDOM } from "../../../../test-support/boot-dom";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { appRoot } from "../../../app/dom-root";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { setLang } from "../../../lib/i18n";
import type { AgentTraceItem } from "../../../lib/operations";
import { AgentStream } from "./agent-stream";

beforeEach(async () => { await resetTestDOM(); setLang("zh"); });
afterEach(() => act(unmountReact));

const empty = { kind: "empty" as const, title: "No history" };

function render(items: AgentTraceItem[]) {
  act(() => renderReact(<AgentStream items={items} working={false} empty={empty} />));
}

function article(text: string): HTMLElement {
  const found = [...appRoot().querySelectorAll<HTMLElement>(".agent-assistant")].find(node => node.textContent?.includes(text));
  if (!found) throw new Error(`reply ${text} not rendered`);
  return found;
}

test("a finished reply stays outside any fold when a tool step and a later reply follow", () => {
  render([
    { type: "user", text: "go" },
    { type: "assistant", text: "one" },
    { type: "tool", name: "read_file", input: "a.ts", output: "out" },
    { type: "assistant", text: "two" },
  ]);
  const one = article("one");
  const two = article("two");
  expect(one.closest("details")).toBeNull();
  expect(two.closest("details")).toBeNull();
  const steps = appRoot().querySelectorAll<HTMLDetailsElement>("details.agent-process");
  expect(steps).toHaveLength(1);
  const card = steps[0];
  expect(card.open).toBeFalse();
  expect(card.querySelector(".agent-tool")).not.toBeNull();
  expect(Boolean(one.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
  expect(Boolean(card.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
});

test("two replies with no step between them are both visible outside any fold", () => {
  render([
    { type: "user", text: "go" },
    { type: "assistant", text: "one" },
    { type: "assistant", text: "two" },
  ]);
  expect(appRoot().querySelectorAll("details")).toHaveLength(0);
  expect(appRoot().textContent).toContain("one");
  expect(appRoot().textContent).toContain("two");
});
