import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { t } from "../../../lib/i18n";
import { OPERATION_INPUT_LIMITS } from "../../../lib/operations";
import {
  bindTermField,
  composeViewSnapshot,
  liveInputPreview,
  sizeCompose,
  submitTyped,
  subscribeComposeView,
} from "./compose";
import { AttachButton } from "../attachments/attach-button";
import { phoneEnterKeyHint } from "../compose-keys";
import { useCompose, useSession } from "../hooks";
import { usePreferences } from "../../settings/hooks";
import { queueKey } from "./keys";
import { ComposeFrame, SendButton, SendIssuePopover, useSendKind } from "./compose-controls";
import { cancelStop, type StopTarget } from "./session-stop";
import { resetSendGate } from "./send-gate";

export type SessionComposeProps = {
  /** True on the phone session dock: ids `compose-text-mobile` vs `compose-text-desktop`. */
  includeBack: boolean;
};

/** Guided compose field. The textarea is controller-owned after mount; React only owns chrome. */
export function SessionCompose({ includeBack }: SessionComposeProps) {
  const snap = useSyncExternalStore(subscribeComposeView, composeViewSnapshot, composeViewSnapshot);
  const paneId = useSession().paneId;
  const focused = useCompose().composeFocused;
  usePreferences();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputID = includeBack ? "compose-text-mobile" : "compose-text-desktop";
  const statusID = `${inputID}-live-status`;
  const pending = snap.live && Boolean(snap.pendingText);
  const aria = snap.live ? t("compose.liveAria") : t("compose.batchAria");
  const placeholder = pending
    ? t("compose.pendingPh", { text: liveInputPreview(snap.pendingText) })
    : snap.live ? t("compose.livePh") : t("compose.batchPh");
  const send = useSendKind({
    paneId,
    hasText: !snap.live && Boolean(snap.draft.trim()),
    live: snap.live,
    submitting: snap.submitBusy && !snap.live,
  });
  const stopTarget = useMemo<StopTarget | null>(
    () => paneId ? { paneId, sendKey: (key) => queueKey(key) } : null,
    [paneId],
  );

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    return bindTermField(input);
  }, [inputID]);

  // A pending send or stop belongs to this pane's dock; neither may fire after it leaves.
  useLayoutEffect(() => () => { resetSendGate(); cancelStop(); }, [paneId]);

  return <form
    className={`dock-form${snap.live ? " live" : ""}${pending ? " live-pending" : ""}`}
    onSubmit={(event) => {
      event.preventDefault();
      void submitTyped(true);
    }}
  >
    <label className="sr-only" htmlFor={inputID}>{aria}</label>
    <span className="sr-only live-input-status" id={statusID} role="status" aria-live="polite">
      {pending ? t("compose.pendingStatus", { n: Array.from(snap.pendingText).length }) : ""}
    </span>
    <AttachButton />
    <ComposeFrame field={inputRef} draft={snap.live ? "" : snap.draft} live={snap.live} focused={focused}
      foldable={includeBack} onResize={() => { if (inputRef.current) sizeCompose(inputRef.current); }}>
      <textarea
        ref={inputRef}
        id={inputID}
        name="pairfob-compose"
        rows={1}
        wrap="soft"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        inputMode="text"
        aria-label={aria}
        aria-describedby={statusID}
        placeholder={placeholder}
        enterKeyHint={includeBack && !snap.live ? phoneEnterKeyHint() : "enter"}
        maxLength={OPERATION_INPUT_LIMITS.prompt}
      />
    </ComposeFrame>
    <div className="send-slot">
      <SendIssuePopover attachments={send.attachments} />
      <SendButton
        kind={send.kind}
        percent={send.attachments.pendingPercent}
        className="send-btn"
        submitsForm
        onSend={() => void submitTyped(true)}
        stopTarget={stopTarget}
        longPressStops={send.working && !snap.live}
      />
    </div>
  </form>;
}
