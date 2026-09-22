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
