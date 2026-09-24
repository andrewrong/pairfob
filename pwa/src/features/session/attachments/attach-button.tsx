import { Paperclip } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { Button } from "../../../shared/ui/primitives/button";
import { computersStore } from "../../computers/catalog-store";
import { connectionStore } from "../../connection/connection-store";
import { capabilitiesStore } from "../../operations/capabilities-store";
import { sessionStore } from "../session-store";
import { haptic } from "../../../lib/dom";
import { attachT } from "./attach-copy";
import { attachmentsAllowed, currentAttachmentScope } from "./attachments-controller";
import { restoreAttachmentScope } from "./attachments-recovery";
import { acceptFiles } from "./attachments-tray-actions";

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
 *
 * A tap opens the system picker directly — one multi-select file input, so
 * the OS offers its own photo library / camera / files menu. Picked files go
 * straight to the tray and upload as soon as a direct connection allows.
 */
export function AttachButton({ labeled = false }: AttachButtonProps) {
  const input = useRef<HTMLInputElement>(null);
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
  return <>
    <Button
      type="button"
      className={labeled ? "attach-btn attach-btn-labeled" : "attach-btn"}
      aria-label={attachT("tray.pick")}
      onClick={() => {
        haptic(2);
        input.current?.click();
      }}
    >
      <Paperclip className="attach-glyph" size={20} aria-hidden="true" />
      {labeled && <span className="attach-btn-text">{attachT("attach.title")}</span>}
    </Button>
    <input ref={input} type="file" multiple tabIndex={-1} aria-hidden="true" className="attach-native-input"
      onChange={(event) => {
        const target = event.currentTarget;
        const files = target.files ? Array.from(target.files) : [];
        // Clearing lets the same file be picked again; a cancelled pick
        // leaves nothing behind.
        target.value = "";
        const scope = currentAttachmentScope();
        if (!scope || !files.length) return;
        void restoreAttachmentScope(scope);
        void acceptFiles(scope, files);
      }} />
  </>;
}
