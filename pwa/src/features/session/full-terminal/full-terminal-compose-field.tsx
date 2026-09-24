import { useLayoutEffect, useMemo, useRef } from "react";
import { useCompose, useSession } from "../hooks";
import { t } from "../../../lib/i18n";
import { OPERATION_INPUT_LIMITS } from "../../../lib/operations";
import { isDesk } from "../../../app/viewport";
import { bindFullTerminalCompose } from "./full-terminal-compose";
import { AttachButton } from "../attachments/attach-button";
import { phoneEnterKeyHint } from "../compose-keys";
import { fitComposeHeight } from "../compose-size";
import { usePreferences } from "../../settings/hooks";
import { ComposeFrame, SendButton, SendIssuePopover, useSendKind } from "../guided/compose-controls";
import { cancelStop, type StopKey, type StopTarget } from "../guided/session-stop";
import { resetSendGate } from "../guided/send-gate";

export type FullTerminalComposeProps = {
  send: (text: string, enter: boolean) => boolean;
};

/** Esc and Ctrl+C as the bytes a terminal key press writes. */
const STOP_BYTES: Record<StopKey, string> = { esc: "\u001b", "ctrl+c": "\u0003" };

/** Batch compose form. The textarea is controller-owned after mount. */
export function FullTerminalCompose({ send }: FullTerminalComposeProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const compose = useCompose();
  const paneId = useSession().paneId;
  usePreferences();
  const phone = !isDesk();
  const sendState = useSendKind({ paneId, hasText: Boolean(compose.composeDraft.trim()), live: false, submitting: false });
  const stopTarget = useMemo<StopTarget | null>(() => paneId ? {
    paneId,
    // A key written into the bridge is exactly what the pad's Esc / Ctrl+C write.
    sendKey: (key) => { if (!sendRef.current(STOP_BYTES[key], false)) throw new Error("terminal not ready"); },
  } : null, [paneId]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    const form = formRef.current;
    if (!field || !form) return;
    return bindFullTerminalCompose(
      field,
      form,
      (text, enter) => sendRef.current(text, enter),
      // The draft reaches React through the compose domain; the feedback only
      // keeps the controller from writing the button's label behind React.
      () => undefined,
      { phoneField: () => !isDesk() },
    );
  }, []);

  useLayoutEffect(() => () => { resetSendGate(); cancelStop(); }, [paneId]);

  const aria = t("compose.batchAria");

  return <form ref={formRef} className="full-terminal-compose-form">
    <label className="sr-only" htmlFor="full-terminal-compose">{aria}</label>
    <AttachButton />
    <ComposeFrame field={fieldRef} draft={compose.composeDraft} live={false} focused={compose.composeFocused}
      foldable={phone} onResize={() => { if (fieldRef.current) fitComposeHeight(fieldRef.current); }}>
      <textarea
        ref={fieldRef}
        id="full-terminal-compose"
        className="full-terminal-compose-input"
        name="pairfob-full-terminal-compose"
        rows={1}
        wrap="soft"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        inputMode="text"
        placeholder={t("compose.batchPh")}
        enterKeyHint={phone ? phoneEnterKeyHint() : "enter"}
        maxLength={OPERATION_INPUT_LIMITS.prompt}
      />
    </ComposeFrame>
    <div className="send-slot">
      <SendIssuePopover attachments={sendState.attachments} />
      <SendButton
        kind={sendState.kind}
        percent={sendState.attachments.pendingPercent}
        className="full-terminal-compose-send"
        submitsForm
        onSend={() => formRef.current?.requestSubmit()}
        stopTarget={stopTarget}
        longPressStops={sendState.working}
      />
    </div>
  </form>;
}
