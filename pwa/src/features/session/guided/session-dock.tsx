import { SessionCompose } from "./session-compose";
import { SessionKeyPad } from "./session-keypad";
import { AttachmentTray } from "../attachments/attachment-tray";
import { useSoftKeyboardOpen } from "../keypad/soft-keyboard";

export type SessionDockProps = {
  /** Phone session chrome includes a back control, so the field id is the mobile one. */
  includeBack: boolean;
};

/**
 * Guided session dock for root integration: keypad + compose.
 * Pass `{ includeBack: true }` on the phone session (field id `compose-text-mobile`)
 * and `{ includeBack: false }` on desktop (`compose-text-desktop`).
 * `SessionCompose` is a stable sibling of the keypad so IME/draft/selection
 * survive local expand/slash morphs and parent output paints.
 * The attachment tray leads the dock and shrinks its thumbnails while the soft
 * keyboard is up.
 */
export function SessionDock({ includeBack }: SessionDockProps) {
  const keyboardOpen = useSoftKeyboardOpen();
  return <div className="dock">
    <AttachmentTray compact={keyboardOpen} />
    <SessionKeyPad />
    <SessionCompose includeBack={includeBack} />
  </div>;
}

export { SessionCompose } from "./session-compose";
export { SessionKeyPad } from "./session-keypad";
export { SessionPadModeBar, SessionSlashPad } from "./session-slash-pad";
