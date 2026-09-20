import { useSyncExternalStore } from "react";
import { Button } from "../../../shared/ui/primitives/button";
import { computersStore } from "../../computers/catalog-store";
import { connectionStore } from "../../connection/connection-store";
import { capabilitiesStore } from "../../operations/capabilities-store";
import { sessionStore } from "../session-store";
import { haptic } from "../../../lib/dom";
import { attachT } from "./attach-copy";
import { attachmentsAllowed, currentAttachmentScope } from "./attachments-controller";
import { presentAttachmentSheet } from "./attachments-sheet";

export type AttachButtonProps = {
  /**
   * Labeled row variant for surfaces without a compose field (full-terminal
   * live mode). The default icon button sits inside a batch compose form.
   */
  labeled?: boolean;
};

/**
 * The one attach affordance, mounted in every compose mode (guided, agent
 * chat, full terminal batch and full terminal live). Hidden (never merely
 * disabled-looking) unless the session is live on an open pane and the
 * computer advertises file upload support.
 */
export function AttachButton({ labeled = false }: AttachButtonProps) {
  const allowed = useSyncExternalStore(
    (listener) => {
      const unsubs = [
        sessionStore.subscribe(listener),
        computersStore.subscribe(listener),
        connectionStore.subscribe(listener),
        capabilitiesStore.subscribe(listener),
      ];
      return () => unsubs.forEach((unsubscribe) => unsubscribe());
    },
    attachmentsAllowed,
  );
  if (!allowed) return null;
  return (
    <Button
      type="button"
      className={labeled ? "attach-btn attach-btn-labeled" : "attach-btn"}
      aria-label={attachT("attach.title")}
      aria-haspopup="dialog"
      onClick={() => {
        haptic(2);
        const scope = currentAttachmentScope();
        if (scope) presentAttachmentSheet(scope);
      }}
    >
      <span className="attach-glyph" aria-hidden="true" />
      {labeled && <span className="attach-btn-text">{attachT("attach.title")}</span>}
    </Button>
  );
}
