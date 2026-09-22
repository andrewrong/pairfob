import { afterEach, expect, test } from "bun:test";
import "../../../test-support/boot-dom";
import { emptyEnvironment } from "../../shared/model/domain-environment";
import { parseQuickCommands, type QuickCommand } from "./quick-command-model";
import { hydratePreferences, preferencesStore, QUICK_COMMANDS_KEY, resetPreferences, setQuickCommands } from "./preferences-store";
const entry: QuickCommand = { id: "test", label: "Run tests", text: "Run relevant tests", pinned: true };
afterEach(() => { resetPreferences(); localStorage.removeItem(QUICK_COMMANDS_KEY); });

test("rejects malformed, oversized and duplicate stored prompts, while preserving an empty list", () => {
  for (const value of [null, {}, [null], [{ ...entry, text: " " }], [{ ...entry, label: "x".repeat(25) }],
    [{ ...entry, text: "x".repeat(4001) }], [entry, entry], [{ ...entry, pinned: "true" }],
    Array.from({ length: 9 }, (_, n) => ({ ...entry, id: `${n}` }))]) expect(parseQuickCommands(value)).toBeNull();
  expect(parseQuickCommands([])).toEqual([]);
});

test("saves detached records and restores order and pins on hydration", () => {
  const items = [entry, { ...entry, id: "second", pinned: false }];
  expect(setQuickCommands(items)).toBe(true);
  items[0] = { ...entry, text: "changed elsewhere" };
  expect(preferencesStore.get().quickCommands?.[0]?.text).toBe(entry.text);
  const raw = localStorage.getItem(QUICK_COMMANDS_KEY);
  resetPreferences();
  hydratePreferences(emptyEnvironment({ read: key => key === QUICK_COMMANDS_KEY ? raw : null }));
  expect(preferencesStore.get().quickCommands?.map(item => [item.id, item.pinned])).toEqual([["test", true], ["second", false]]);
  expect(setQuickCommands([{ ...entry, text: "" }])).toBe(false);
  expect(localStorage.getItem(QUICK_COMMANDS_KEY)).toBe(raw);
  hydratePreferences(emptyEnvironment({ read: () => "{bad" }));
  expect(preferencesStore.get().quickCommands).toBeNull();
});
