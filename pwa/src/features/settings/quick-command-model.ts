/** Device-local prompt snippets. No storage or browser access at import time. */
export type QuickCommand = { id: string; label: string; text: string; pinned: boolean };
export const QUICK_COMMAND_LIMIT = 24;
export const QUICK_LABEL_LIMIT = 24;
export const QUICK_TEXT_LIMIT = 4000;
export const QUICK_PIN_LIMIT = 8;

export function parseQuickCommands(value: unknown): QuickCommand[] | null {
  if (!Array.isArray(value) || value.length > QUICK_COMMAND_LIMIT) return null;
  const ids = new Set<string>();
  let pins = 0;
  const result: QuickCommand[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { id, label, text, pinned } = item;
    if (typeof id !== "string" || !id || id.length > 80 || ids.has(id)
      || typeof label !== "string" || !label.trim() || label.length > QUICK_LABEL_LIMIT
      || typeof text !== "string" || !text.trim() || text.length > QUICK_TEXT_LIMIT
      || typeof pinned !== "boolean" || (pinned && ++pins > QUICK_PIN_LIMIT)) return null;
    ids.add(id);
    result.push({ id, label: label.trim(), text, pinned });
  }
  return result;
}

/**
 * One cell of the command pad. Order is the array order with pinned commands
 * first, then the agent's slash commands, then the rest; `pinned` therefore
 * means "placed before the first slash command".
 */
export type CommandPadCell = { kind: "quick"; command: QuickCommand } | { kind: "slash"; index: number };

export function arrangeCommandPad(commands: readonly QuickCommand[], slashCount: number): CommandPadCell[] {
  const quick = (command: QuickCommand): CommandPadCell => ({ kind: "quick", command });
  return [
    ...commands.filter(command => command.pinned).map(quick),
    ...Array.from({ length: slashCount }, (_, index): CommandPadCell => ({ kind: "slash", index })),
    ...commands.filter(command => !command.pinned).map(quick),
  ];
}

/**
 * Drop an own command onto pad cell `to`. Landing before the first slash command
 * pins it; a ninth pin is refused rather than silently pushed later. Without
 * slash commands the pad is the plain list, so the number of pins is kept.
 */
export function moveQuickCommand(commands: readonly QuickCommand[], id: string, to: number,
  slashCount: number): QuickCommand[] | "pins-full" {
  const cells = arrangeCommandPad(commands, slashCount);
  const from = cells.findIndex(cell => cell.kind === "quick" && cell.command.id === id);
  if (from < 0) return commands.map(command => ({ ...command }));
  const [moved] = cells.splice(from, 1);
  cells.splice(Math.max(0, Math.min(cells.length, to)), 0, moved!);
  const firstSlash = cells.findIndex(cell => cell.kind === "slash");
  const pinCount = commands.filter(command => command.pinned).length;
  const ordered = cells.flatMap(cell => cell.kind === "quick" ? [cell.command] : []);
  const result = ordered.map((command, index) => ({
    ...command,
    pinned: firstSlash < 0 ? index < pinCount : cells.findIndex(cell => cell.kind === "quick" && cell.command === command) < firstSlash,
  }));
  return result.filter(command => command.pinned).length > QUICK_PIN_LIMIT ? "pins-full" : result;
}

/** A new command joins the end of page 1 while it has room, otherwise the end of the pad. */
export function addQuickCommand(commands: readonly QuickCommand[], entry: Omit<QuickCommand, "pinned">):
  { commands: QuickCommand[]; placement: "first" | "last" } | null {
  if (commands.length >= QUICK_COMMAND_LIMIT) return null;
  const next = commands.map(command => ({ ...command }));
  const pins = next.filter(command => command.pinned).length;
  if (pins >= QUICK_PIN_LIMIT) return { commands: [...next, { ...entry, pinned: false }], placement: "last" };
  const lastPin = next.map(command => command.pinned).lastIndexOf(true);
  next.splice(lastPin + 1, 0, { ...entry, pinned: true });
  return { commands: next, placement: "first" };
}

/**
 * Move an own command one slot for keyboard and screen-reader users. A step
 * across the slash commands lands just on the other side of them, so one step
 * pins or unpins; null means there is no slot that way.
 */
export function stepQuickCommand(commands: readonly QuickCommand[], id: string, direction: -1 | 1,
  slashCount: number): QuickCommand[] | "pins-full" | null {
  const cells = arrangeCommandPad(commands, slashCount);
  const from = cells.findIndex(cell => cell.kind === "quick" && cell.command.id === id);
  if (from < 0) return null;
  let to = from + direction;
  while (cells[to]?.kind === "slash") {
    if (!cells[to + direction] || cells[to + direction]!.kind === "quick") break;
    to += direction;
  }
  if (to < 0 || to >= cells.length) return null;
  return moveQuickCommand(commands, id, to, slashCount);
}
