import { flushSync } from "react-dom";
import { KeyLabel } from "../keypad/key-label";
import { ChevronDown, Ellipsis, LockKeyhole } from "lucide-react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { composeFocused, composeIME, composeLive, setComposeDraft } from "../compose-store";
import { useCompose } from "../hooks";
import { usePreferences } from "../../settings/hooks";
import { keysExpanded, setKeysExpanded } from "../../settings/preferences-store";
import { t } from "../../../lib/i18n";
import {
  type FullTerminalControlsOptions,
  requestFullTerminalPadEnter,
  insertFullTerminalNewline,
  setFullTerminalComposeText,
  setFullTerminalInputMode,
} from "./full-terminal-compose";
import {
  fullTerminalKeyboardOpen,
  notifyFullTerminalKeyboard,
  subscribeFullTerminalKeyboard,
} from "./full-terminal-input";
import { useModifierScope } from "../keypad/modifier-scope";
import { bindPadPress } from "../keypad/key-press";
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
  withModifiers,
  type KeySpec,
} from "../keypad/keypad";
import { FullTerminalCompose } from "./full-terminal-compose-field";
import { AttachButton } from "../attachments/attach-button";
import { PadChromeButton } from "../compose-focus";
import { SessionPadModeBar, SessionSlashPad } from "../guided/session-slash-pad";

function keyAria(spec: KeySpec): string | undefined {
  const mapped = spec.key === "up" ? t("key.up")
    : spec.key === "down" ? t("key.down")
    : spec.key === "left" ? t("key.left")
    : spec.key === "right" ? t("key.right")
    : spec.key === "backspace" ? t("key.backspace")
    : spec.aria ?? spec.label;
  return mapped || undefined;
}

function FullTerminalKeyButton({ spec, onKey }: { spec: KeySpec; onKey: (key: string, el: HTMLElement) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (spec.modifier) return bindModifier(el, spec.modifier).destroy;
    const { destroy } = bindPadPress(el, () => {
      for (const key of withModifiers(spec.key)) onKeyRef.current(key, el);
    }, { repeat: spec.repeat === true });
    return destroy;
  }, [spec.key, spec.modifier, spec.repeat]);
  const locked = Boolean(spec.modifier && modifierIsLocked(spec.modifier));
  const latched = Boolean(spec.modifier && modifierIsActive(spec.modifier));
  return <button
    ref={ref}
    type="button"
    className={spec.modifier ? `key key-mod${latched ? " on" : ""}${locked ? " is-locked" : ""}` : "key"}
    aria-label={keyAria(spec)}
    data-locked={spec.modifier ? String(locked) : undefined}
    title={spec.modifier ? t(locked ? "keys.modifierLocked" : "keys.modifierHint") : undefined}
    aria-description={spec.modifier ? t(locked ? "keys.modifierLocked" : "keys.modifierHint") : undefined}
    aria-pressed={spec.modifier ? (latched ? "true" : "false") : undefined}
  ><KeyLabel spec={spec} />{locked && <LockKeyhole className="key-lock" size={12} aria-hidden="true" />}</button>;
}

function KeyRow({ specs, label, extra, onKey }: {
  specs: KeySpec[];
  label: string;
  extra?: ReactNode;
  onKey: (key: string, el: HTMLElement) => void;
}) {
  return <div className="keys" role="group" aria-label={label}>
    {specs.map((spec) => <FullTerminalKeyButton key={spec.key} spec={spec} onKey={onKey} />)}
    {extra}
  </div>;
}

function FullTerminalKeyboardButton({
  keyboard,
}: {
  keyboard: FullTerminalControlsOptions["keyboard"];
}) {
  const open = useSyncExternalStore(subscribeFullTerminalKeyboard, fullTerminalKeyboardOpen, fullTerminalKeyboardOpen);
  const ref = useRef<HTMLButtonElement>(null);
  const keyboardRef = useRef(keyboard);
  keyboardRef.current = keyboard;
  useLayoutEffect(() => {
    notifyFullTerminalKeyboard(keyboardRef.current.isOpen());
    const el = ref.current;
    if (!el) return;
    return bindPadPress(el, () => {
      keyboardRef.current.toggle();
      notifyFullTerminalKeyboard(keyboardRef.current.isOpen());
    }).destroy;
  }, []);
  return <button
    ref={ref}
    type="button"
    className="full-terminal-kb"
    aria-pressed={open ? "true" : "false"}
    aria-label={open ? t("ft.kbHide") : t("ft.kbOpen")}
  >{open ? t("ft.kbHide") : t("ft.kbType")}</button>;
}

function FullTerminalPadControls({
  optionsRef,
  padRef,
}: {
  optionsRef: { current: FullTerminalControlsOptions };
  padRef: { current: HTMLDivElement | null };
}) {
  useModifierScope();
  useSyncExternalStore(subscribeModifiers, modifierSnapshot, modifierSnapshot);
  const [, bump] = useState(0);
  const restoreCompose = (): void => {
    const field = padRef.current?.querySelector<HTMLTextAreaElement>(".full-terminal-compose-input");
    if (field && (composeFocused() || composeIME())) field.focus({ preventScroll: true });
  };
  const repaint = () => {
    bump((n) => n + 1);
    restoreCompose();
  };
  const compose = useCompose();
  const preferences = usePreferences();
  const live = compose.composeLive;
  const expanded = preferences.keysExpanded;

  const onKey = (key: string, _el: HTMLElement): void => {
    if (!composeLive() && key === "enter") {
      const pad = padRef.current;
      if (pad) requestFullTerminalPadEnter(pad);
      return;
    }
    optionsRef.current.sendKey(key);
  };

  const selectCommand = (text: string): void => {
    if (composeLive()) {
      optionsRef.current.sendCompose(text, false);
      return;
    }
    const pad = padRef.current;
    if (pad) setFullTerminalComposeText(pad, text);
  };

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

  return <div className="full-terminal-pad-controls">
    {live && <FullTerminalKeyboardButton keyboard={optionsRef.current.keyboard} />}
    <KeyRow specs={PRIMARY_KEYS} label={t("keys.primary")} extra={more} onKey={onKey} />
    {expanded && <SessionSlashPad onSelect={selectCommand} onCustomSelect={(text) => {
      flushSync(() => {
        setFullTerminalInputMode(false, optionsRef.current.sendCompose, repaint);
        setComposeDraft(text);
      });
      if (padRef.current) setFullTerminalComposeText(padRef.current, text);
    }} keyItems={[
      ...EXPANDED_KEYS.map((spec) => spec.key === "ctrl+c"
        ? <PadChromeButton key="newline" type="button" className="key"
        aria-label={t("keys.newlineAria")} onClick={() => {
          if (composeLive()) optionsRef.current.sendKey("enter");
          else if (padRef.current) insertFullTerminalNewline(padRef.current);
        }}>{t("keys.newline")}</PadChromeButton>
        : <FullTerminalKeyButton key={spec.key} spec={spec} onKey={onKey} />),
      ...EXPANDED_KEYS.filter((spec) => spec.key === "ctrl+c")
        .map((spec) => <FullTerminalKeyButton key={spec.key} spec={spec} onKey={onKey} />),
      ...EXTRA_KEYS.map((spec) => <FullTerminalKeyButton key={spec.key} spec={spec} onKey={onKey} />),
    ]} />}
  </div>;
}

export type FullTerminalPadProps = {
  options: FullTerminalControlsOptions;
};

/**
 * Complete-terminal pad + batch compose.
 * Keys go through `options.sendKey` (withModifiers), never the guided session key queue.
 * Compose is a sibling of the controls so expand/slash morphs do not remount the field.
 * Keep `options` callbacks stable across chrome updates.
 */
export function FullTerminalPad({ options }: FullTerminalPadProps) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const padRef = useRef<HTMLDivElement>(null);
  const compose = useCompose();
  const live = compose.composeLive;
  const desk = options.desk;

  useLayoutEffect(() => {
    const keyboard = optionsRef.current.keyboard;
    if (composeLive()) {
      if (desk) keyboard.open();
    } else {
      keyboard.close();
    }
    notifyFullTerminalKeyboard(keyboard.isOpen());
  }, [live, desk]);

  return <div
    ref={padRef}
    className="full-terminal-pad"
    data-input-mode={live ? "live" : "compose"}
  >
    <FullTerminalPadControls optionsRef={optionsRef} padRef={padRef} />
    {live && <div className="full-terminal-live-actions">
      <AttachButton labeled />
    </div>}
    {!live && <FullTerminalCompose send={(text, enter) => optionsRef.current.sendCompose(text, enter)} />}
  </div>;
}
