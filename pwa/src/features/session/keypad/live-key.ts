import { withModifiers } from "./keypad";
import { encodeTerminalKey } from "./terminal-keys";

/** Apply the pad's modifiers to a typed character, never multi-character/IME text or encoded terminal sequences. */
export function encodeLiveKey(text: string): string {
  if (!/^[\x20-\x7e]$/.test(text)) return text;
  return withModifiers(text).map(key => encodeTerminalKey(key)).join("") || text;
}
