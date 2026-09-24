import { LockKeyhole } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { t } from "../../../lib/i18n";
import { bindModifier, modifierIsActive, modifierIsLocked, type KeySpec } from "./keypad";
import { bindPadPress } from "./key-press";
import { KeyLabel, keyAria } from "./key-label";

/**
 * One pad keycap, shared by the guided and complete-terminal pads so both draw
 * the same caps. Modifiers latch here; every other key calls `onPress`, which
 * owns the transport. Callers repaint through `subscribeModifiers`.
 */
export function PadKey({ spec, onPress }: { spec: KeySpec; onPress: (el: HTMLElement) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (spec.modifier) return bindModifier(el, spec.modifier).destroy;
    return bindPadPress(el, () => onPressRef.current(el), { repeat: spec.repeat === true }).destroy;
  }, [spec.key, spec.modifier, spec.repeat]);
  const locked = Boolean(spec.modifier && modifierIsLocked(spec.modifier));
  const latched = Boolean(spec.modifier && modifierIsActive(spec.modifier));
  const hint = spec.modifier ? t(locked ? "keys.modifierLocked" : "keys.modifierHint") : undefined;
  return <button
    ref={ref}
    type="button"
    className={spec.modifier ? `key key-mod${latched ? " on" : ""}${locked ? " is-locked" : ""}` : "key"}
    aria-label={keyAria(spec)}
    data-locked={spec.modifier ? String(locked) : undefined}
    title={hint}
    aria-description={hint}
    aria-pressed={spec.modifier ? (latched ? "true" : "false") : undefined}
  ><KeyLabel spec={spec} />{locked && <LockKeyhole className="key-lock" size={12} aria-hidden="true" />}</button>;
}
