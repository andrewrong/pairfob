/**
 * Tests stub document.execCommand on the shared Happy DOM document. Call this once at file top level to
 * get a function that gives the original back; run it in afterEach, or a later file's failed clipboard
 * write falls through to a selection copy that "succeeds".
 */
import { happy } from "./dom";

export function captureExecCommand(): () => void {
  const original = Object.getOwnPropertyDescriptor(happy.document, "execCommand");
  return () => {
    if (original) Object.defineProperty(happy.document, "execCommand", original);
    else delete (happy.document as unknown as { execCommand?: unknown }).execCommand;
  };
}
