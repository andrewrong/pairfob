import { afterEach, expect, test } from "bun:test";
import "../../../test-support/boot-dom";
import { emptyEnvironment } from "../../shared/model/domain-environment";
import { addQuickCommand, arrangeCommandPad, moveQuickCommand, parseQuickCommands, stepQuickCommand, type QuickCommand } from "./quick-command-model";
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

const own = (id: string, pinned: boolean): QuickCommand => ({ id, label: id, text: `${id} text`, pinned });
const layout = (commands: QuickCommand[], slash: number) => arrangeCommandPad(commands, slash)
  .map(cell => cell.kind === "quick" ? cell.command.id : `/${cell.index}`);

test("the pad shows pinned commands, then slash commands, then the rest", () => {
  expect(layout([own("a", false), own("b", true), own("c", false)], 2)).toEqual(["b", "/0", "/1", "a", "c"]);
  expect(layout([], 1)).toEqual(["/0"]);
});

test("dropping on a cell takes its place and pinning follows the slash boundary", () => {
  const commands = [own("a", true), own("b", true), own("c", false)];
  // Pad: a b /0 /1 c. Dropping c on /0 pins it; dropping a on /1 unpins it.
  const pinned = moveQuickCommand(commands, "c", 2, 2);
  expect(pinned !== "pins-full" && layout(pinned, 2)).toEqual(["a", "b", "c", "/0", "/1"]);
  const unpinned = moveQuickCommand(commands, "a", 3, 2);
  expect(unpinned !== "pins-full" && layout(unpinned, 2)).toEqual(["b", "/0", "/1", "a", "c"]);
  expect(unpinned !== "pins-full" && unpinned.map(item => [item.id, item.pinned])).toEqual([["b", true], ["a", false], ["c", false]]);
  const reordered = moveQuickCommand(commands, "b", 0, 2);
  expect(reordered !== "pins-full" && reordered.map(item => item.id)).toEqual(["b", "a", "c"]);
  expect(commands.map(item => item.pinned)).toEqual([true, true, false]);
});

test("a ninth pinned command is refused, and a plain pad keeps its pin count", () => {
  const full = [...Array.from({ length: 8 }, (_, n) => own(`p${n}`, true)), own("x", false)];
  expect(moveQuickCommand(full, "x", 0, 3)).toBe("pins-full");
  const plain = moveQuickCommand([own("a", true), own("b", false)], "b", 0, 0);
  expect(plain !== "pins-full" && plain.map(item => [item.id, item.pinned])).toEqual([["b", true], ["a", false]]);
  expect(parseQuickCommands(moveQuickCommand(full, "p0", 20, 3))).not.toBeNull();
});

test("new commands join the end of page 1 until it is full, then the end", () => {
  const first = addQuickCommand([own("a", true), own("b", false)], { id: "n", label: "N", text: "n" });
  expect(first?.placement).toBe("first");
  expect(first?.commands.map(item => [item.id, item.pinned])).toEqual([["a", true], ["n", true], ["b", false]]);
  const full = Array.from({ length: 8 }, (_, n) => own(`p${n}`, true));
  const last = addQuickCommand(full, { id: "n", label: "N", text: "n" });
  expect(last?.placement).toBe("last");
  expect(last?.commands.at(-1)).toEqual({ id: "n", label: "N", text: "n", pinned: false });
  expect(addQuickCommand(Array.from({ length: 24 }, (_, n) => own(`q${n}`, false)), { id: "n", label: "N", text: "n" })).toBeNull();
});

test("one step moves one slot, and a step across the slash commands pins or unpins", () => {
  const commands = [own("a", true), own("b", true), own("c", false)];
  const step = (id: string, direction: -1 | 1, list = commands) => {
    const next = stepQuickCommand(list, id, direction, 2);
    return next === null || next === "pins-full" ? next : layout(next, 2);
  };
  expect(step("a", 1)).toEqual(["b", "a", "/0", "/1", "c"]);
  expect(step("b", 1)).toEqual(["a", "/0", "/1", "b", "c"]);
  expect(step("c", -1)).toEqual(["a", "b", "c", "/0", "/1"]);
  expect(step("a", -1)).toBeNull();
  expect(step("c", 1)).toBeNull();
  const full = [...Array.from({ length: 8 }, (_, n) => own(`p${n}`, true)), own("x", false)];
  expect(stepQuickCommand(full, "x", -1, 2)).toBe("pins-full");
  const plain = stepQuickCommand([own("a", true), own("b", false)], "b", -1, 0);
  expect(plain !== null && plain !== "pins-full" && plain.map(item => [item.id, item.pinned])).toEqual([["b", true], ["a", false]]);
});
