import { KeyLabel } from "../keypad/key-label";
import { ChevronDown, Ellipsis, LockKeyhole } from "lucide-react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { t } from "../../../lib/i18n";
import { keysExpanded, setKeysExpanded } from "../../settings/preferences-store";
import {
  PRIMARY_KEYS,
  EXPANDED_KEYS,
  EXTRA_KEYS,
  bindModifier,
  clearModifiers,
  modifierIsActive,
  modifierIsLocked,
  modifierSnapshot,
  subscribeModifiers,
  type KeySpec,
} from "../keypad/keypad";
import { useModifierScope } from "../keypad/modifier-scope";
import { bindPadPress } from "../keypad/key-press";
import { insertNewline } from "./compose";
import { queueKey } from "./keys";
import { PadChromeButton } from "../compose-focus";
import { SessionPadModeBar, SessionSlashPad } from "./session-slash-pad";

function SessionKeyButton({ spec }: { spec: KeySpec }) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (spec.modifier) return bindModifier(el, spec.modifier).destroy;
    const { destroy } = bindPadPress(el, () => queueKey(spec.key, el), { repeat: spec.repeat === true });
    return destroy;
  }, [spec.key, spec.modifier, spec.repeat]);
  const mapped = spec.key === "up" ? t("key.up")
    : spec.key === "down" ? t("key.down")
    : spec.key === "left" ? t("key.left")
    : spec.key === "right" ? t("key.right")
    : spec.key === "backspace" ? t("key.backspace")
    : spec.aria ?? spec.label;
  const locked = Boolean(spec.modifier && modifierIsLocked(spec.modifier));
  const latched = Boolean(spec.modifier && modifierIsActive(spec.modifier));
  return <button
    ref={ref}
    type="button"
    className={spec.modifier ? `key key-mod${latched ? " on" : ""}${locked ? " is-locked" : ""}` : "key"}
    aria-label={mapped || undefined}
    data-locked={spec.modifier ? String(locked) : undefined}
    title={spec.modifier ? t(locked ? "keys.modifierLocked" : "keys.modifierHint") : undefined}
    aria-description={spec.modifier ? t(locked ? "keys.modifierLocked" : "keys.modifierHint") : undefined}
    aria-pressed={spec.modifier ? (latched ? "true" : "false") : undefined}
  ><KeyLabel spec={spec} />{locked && <LockKeyhole className="key-lock" size={12} aria-hidden="true" />}</button>;
}

function KeyRow({ specs, label, extra }: { specs: KeySpec[]; label: string; extra?: ReactNode }) {
  return <div className="keys" role="group" aria-label={label}>
    {specs.map((spec) => <SessionKeyButton key={spec.key} spec={spec} />)}
    {extra}
  </div>;
}

/** Guided keypad. Expanding/morphing must not remount `SessionCompose`. */
export function SessionKeyPad() {
  useModifierScope();
  useSyncExternalStore(subscribeModifiers, modifierSnapshot, modifierSnapshot);
  const [, bump] = useState(0);
  const repaint = () => bump((n) => n + 1);
  const expanded = keysExpanded();
  const more = (
    <>
      {expanded && <SessionPadModeBar onRepaint={repaint} />}
      <PadChromeButton
        type="button"
        className="key key-more"
        aria-label={t("keys.morePad")}
        aria-expanded={expanded ? "true" : "false"}
        onClick={() => {
          clearModifiers();
          setKeysExpanded(!keysExpanded());
          repaint();
        }}
      >{expanded ? <ChevronDown size={20} aria-hidden="true" /> : <Ellipsis size={20} aria-hidden="true" />}</PadChromeButton>
    </>
  );
  return <div className="keys-wrap">
    <KeyRow specs={PRIMARY_KEYS} label={t("keys.primary")} extra={more} />
    {expanded && <SessionSlashPad keyItems={[
      ...EXPANDED_KEYS.map((spec) => spec.key === "ctrl+c"
        ? <PadChromeButton key="newline" type="button" className="key"
          aria-label={t("keys.newlineAria")} onClick={insertNewline}>{t("keys.newline")}</PadChromeButton>
        : <SessionKeyButton key={spec.key} spec={spec} />),
      ...EXPANDED_KEYS.filter((spec) => spec.key === "ctrl+c")
        .map((spec) => <SessionKeyButton key={spec.key} spec={spec} />),
      ...EXTRA_KEYS.map((spec) => <SessionKeyButton key={spec.key} spec={spec} />),
    ]} />}
  </div>;
}
