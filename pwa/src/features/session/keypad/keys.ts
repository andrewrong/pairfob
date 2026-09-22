/** Pad key tables. No state, paint, or DOM. */

export type Modifier = "ctrl" | "alt" | "shift" | "cmd";

export type KeySpec = {
  key: string;
  label?: string;
  aria?: string;
  repeat?: boolean;
  modifier?: Modifier;
};

/** Primary phone row: escape, movement, delete. */
export const PRIMARY_KEYS: KeySpec[] = [
  { key: "esc", label: "Esc" },
  { key: "up", label: "↑", repeat: true },
  { key: "down", label: "↓", repeat: true },
  { key: "left", label: "←", repeat: true },
  { key: "right", label: "→", repeat: true },
  { key: "backspace", label: "⌫", repeat: true },
];

export const SECONDARY_KEYS: KeySpec[] = [
  { key: "tab", label: "Tab" },
  { key: "enter", label: "Enter" },
  { key: "ctrl+c", label: "Ctrl+C" },
  { key: "ctrl+z", label: "Ctrl+Z" },
  { key: "ctrl+d", label: "Ctrl+D" },
  { key: "ctrl+l", label: "Ctrl+L" },
];

/**
 * Extra row when expanded. Modifiers can be held or latched for the next key.
 * Modified keys use terminal encoding; Cmd retains the pad’s Ctrl alias.
 */
export const TERTIARY_KEYS: KeySpec[] = [
  { key: "ctrl", label: "Ctrl", aria: "Control", modifier: "ctrl" },
  { key: "alt", label: "Opt", aria: "Option", modifier: "alt" },
  { key: "shift", label: "Shift", aria: "Shift", modifier: "shift" },
  { key: "cmd", label: "Cmd", aria: "Command", modifier: "cmd" },
  { key: "ctrl+a", label: "Ctrl+A", repeat: true },
  { key: "ctrl+e", label: "Ctrl+E", repeat: true },
  { key: "ctrl+k", label: "Ctrl+K", repeat: true },
];

/** Keep every modifier on the same page so held and locked chords remain reachable. */
export const EXPANDED_KEYS: KeySpec[] = [
  ...TERTIARY_KEYS.filter((key) => key.modifier),
  ...SECONDARY_KEYS,
  ...TERTIARY_KEYS.filter((key) => !key.modifier),
];

/** Editing and TUI choices; these keys never append Enter. */
export const EXTRA_KEYS: KeySpec[] = [
  { key: "shift+tab", label: "⇧Tab", aria: "Shift+Tab" },
  { key: "ctrl+w", label: "Ctrl+W" },
  { key: "ctrl+u", label: "Ctrl+U" },
  { key: "ctrl+r", label: "Ctrl+R" },
  { key: "ctrl+y", label: "Ctrl+Y" },
  { key: "alt+b", label: "Alt+B", repeat: true },
  { key: "alt+f", label: "Alt+F", repeat: true },
  ...["1", "2", "3", "4", "5", "y", "n"].map(key => ({ key, label: key.toUpperCase() })),
];
