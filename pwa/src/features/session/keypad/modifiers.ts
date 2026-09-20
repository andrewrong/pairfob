import { encodeTerminalKey } from "./terminal-keys";

/** Pure pad-token remap. Controller code owns latch/consume side effects. */

export type PadModifierFlags = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  cmd: boolean;
};

export function mapPadKey(key: string, flags: PadModifierFlags): string[] {
  // Retain the pad's existing Cmd-as-Ctrl terminal alias, not a remote GUI Cmd.
  let ctrl = flags.ctrl || flags.cmd;
  let alt = flags.alt;
  let shift = flags.shift;
  let match: RegExpExecArray | null;
  while ((match = /^(ctrl|alt|shift)\+/.exec(key))) {
    ctrl ||= match[1] === "ctrl";
    alt ||= match[1] === "alt";
    shift ||= match[1] === "shift";
    key = key.slice(match[0].length);
  }
  if (!ctrl && !alt && shift && Array.from(key).length === 1) return [key.toUpperCase()];
  const chord = [ctrl && "ctrl", alt && "alt", shift && "shift", key].filter(Boolean).join("+");
  return encodeTerminalKey(chord) ? [chord] : [];
}
