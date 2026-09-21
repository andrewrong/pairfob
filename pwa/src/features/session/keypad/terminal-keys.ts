/** Legacy xterm key encoding, shared by the PTY bridge and guided keypad. */
const directions: Record<string, string> = { up: "A", down: "B", right: "C", left: "D" };

export function encodeTerminalKey(key: string, applicationCursor = false): string {
  let ctrl = false, alt = false, shift = false;
  let match: RegExpExecArray | null;
  while ((match = /^(ctrl|alt|shift)\+/.exec(key))) {
    ctrl ||= match[1] === "ctrl";
    alt ||= match[1] === "alt";
    shift ||= match[1] === "shift";
    key = key.slice(match[0].length);
  }
  const direction = Object.hasOwn(directions, key) ? directions[key] : undefined;
  const modifiers = Number(shift) + Number(alt) * 2 + Number(ctrl) * 4;
  if (direction) return modifiers
    ? `\x1b[1;${modifiers + 1}${direction}`
    : `\x1b${applicationCursor ? "O" : "["}${direction}`;
  // These intentionally follow xterm's legacy keyboard behavior. Some chords
  // share bytes (e.g. Ctrl+Shift+C and Ctrl+C); GUI Command is not a PTY key.
  if (key === "tab") return shift ? "\x1b[Z" : "\t";
  let bytes: string;
  if (key === "enter") bytes = "\r";
  else if (key === "esc") bytes = "\x1b";
  else if (key === "backspace") bytes = ctrl ? "\b" : "\x7f";
  else if (/^[a-z]$/i.test(key)) bytes = ctrl
    ? String.fromCharCode(key.toLowerCase().charCodeAt(0) - 96)
    : shift ? key.toUpperCase() : key;
  else if (ctrl && /^[ @\[\\\]\^_]$/.test(key)) bytes = String.fromCharCode(key.charCodeAt(0) & 0x1f);
  else if (ctrl && key === "?") bytes = "\x7f";
  else if (ctrl && /^[3-7]$/.test(key)) bytes = String.fromCharCode(Number(key) + 24);
  else if (ctrl && key === "8") bytes = "\x7f";
  else if (!ctrl && Array.from(key).length === 1) bytes = shift ? key.toUpperCase() : key;
  else return "";
  return (alt ? "\x1b" : "") + bytes;
}

/** Native SendKeys only accepts ctrl+letter; other chords need one PTY write. */
export function requiresTerminalText(key: string): boolean {
  return /^(ctrl|alt|shift)\+/.test(key) && !/^ctrl\+[a-z]$/.test(key);
}
