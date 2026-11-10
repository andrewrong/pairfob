/** Copy text to the clipboard. Resolves false only when both the Clipboard API and the selection fallback fail. */
export function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return Promise.resolve(selectionCopy(text));
  return clipboard.writeText(text).then(() => true, () => selectionCopy(text));
}

// Plain-http pages are not a secure context on iOS Safari; copy through a selected off-screen span.
// A textarea fails there: its value has no text node to select and it is never focused. A contenteditable
// span holding a real text node, selected by a Range inside the tap, is what execCommand("copy") reads.
// white-space:pre keeps newlines; user-select:text defeats an ancestor with user-select:none.
function selectionCopy(text: string): boolean {
  const span = document.createElement("span");
  span.textContent = text;
  span.contentEditable = "true";
  span.setAttribute("aria-hidden", "true");
  span.style.cssText =
    "position:fixed;top:0;left:0;opacity:0;font-size:16px;white-space:pre;user-select:text;-webkit-user-select:text;";
  const onCopy = (event: Event): void => {
    const data = (event as ClipboardEvent).clipboardData;
    if (!data) return;
    event.preventDefault();
    data.setData("text/plain", text);
  };
  document.addEventListener("copy", onCopy, { once: true });
  document.body.appendChild(span);
  const selection = window.getSelection();
  try {
    const range = document.createRange();
    range.selectNodeContents(span);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy);
    selection?.removeAllRanges();
    span.remove();
  }
}
