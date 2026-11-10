/** Copy text to the clipboard. Resolves false only when both the Clipboard API and the selection fallback fail. */
export function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return Promise.resolve(selectionCopy(text));
  return clipboard.writeText(text).then(() => true, () => selectionCopy(text));
}

// Plain-http pages are not a secure context on iOS Safari; copy through a selected hidden textarea.
// The textarea needs: readOnly + contentEditable, a Range selection (select() does nothing on iOS),
// and fixed position at 16px so the page neither zooms nor scrolls.
function selectionCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.contentEditable = "true";
  area.setAttribute("aria-hidden", "true");
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";
  document.body.appendChild(area);
  try {
    const range = document.createRange();
    range.selectNodeContents(area);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
