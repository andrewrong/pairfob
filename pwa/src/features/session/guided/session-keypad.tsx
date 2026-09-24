import { ChevronDown, Ellipsis } from "lucide-react";
import { useSyncExternalStore } from "react";
import { t } from "../../../lib/i18n";
import { usePreferences } from "../../settings/hooks";
import { keysExpanded, setKeysExpanded } from "../../settings/preferences-store";
import {
  PRIMARY_KEYS,
  EXPANDED_KEYS,
  EXTRA_KEYS,
  clearModifiers,
  modifierSnapshot,
  subscribeModifiers,
} from "../keypad/keypad";
import { useModifierScope } from "../keypad/modifier-scope";
import { PadKey } from "../keypad/pad-key";
import { dismissSoftKeyboard, useSoftKeyboardOpen } from "../keypad/soft-keyboard";
import { queueKey } from "./keys";
import { PadChromeButton } from "../compose-focus";
import { SessionSlashPad } from "./session-slash-pad";

const sendKey = (key: string) => (el: HTMLElement) => queueKey(key, el);

/**
 * Guided keypad. Expanding/morphing must not remount `SessionCompose`.
 * The primary row is seven equal cells in every state; ⋯ and ⌄ trade places
 * in the last one. The pad and the soft keyboard are never shown together:
 * while the keyboard is up only the primary row renders, and the preference is
 * left alone so the pad comes back when the keyboard goes.
 */
export function SessionKeyPad() {
  useModifierScope();
  useSyncExternalStore(subscribeModifiers, modifierSnapshot, modifierSnapshot);
  const keyboard = useSoftKeyboardOpen();
  const expanded = usePreferences().keysExpanded && !keyboard;
  return <div className="keys-wrap">
    <div className="keys" role="group" aria-label={t("keys.primary")}>
      {PRIMARY_KEYS.map((spec) => <PadKey key={spec.key} spec={spec} onPress={sendKey(spec.key)} />)}
      <PadChromeButton
        type="button"
        className="key key-more"
        aria-label={t("keys.morePad")}
        aria-expanded={expanded ? "true" : "false"}
        onClick={() => {
          clearModifiers();
          if (keyboard) {
            dismissSoftKeyboard();
            setKeysExpanded(true);
          } else setKeysExpanded(!keysExpanded());
        }}
      >{expanded ? <ChevronDown size={20} aria-hidden="true" /> : <Ellipsis size={20} aria-hidden="true" />}</PadChromeButton>
    </div>
    {expanded && <SessionSlashPad keyItems={[...EXPANDED_KEYS, ...EXTRA_KEYS]
      .map((spec) => <PadKey key={spec.key} spec={spec} onPress={sendKey(spec.key)} />)} />}
  </div>;
}
