import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { copyText } from "../../../lib/clipboard-copy";

/**
 * A shell command the reader runs on the computer, with a copy button. Copy
 * failure is shown on the button; the command stays selectable either way.
 */
export function CommandLine({ command, labels }: { command: string; labels: { copy: string; copied: string; failed: string } }) {
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");
  return <div className="command-line">
    <code>{command}</code>
    <Button className="set-action command-copy" onClick={() => {
      void copyText(command).then((ok) => setState(ok ? "copied" : "failed"));
    }}><Copy size={14} aria-hidden="true" />{state === "ready" ? labels.copy : state === "copied" ? labels.copied : labels.failed}</Button>
  </div>;
}
