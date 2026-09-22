import { applySnapshot as seedPadSnapshot } from "../../dashboard/catalog-store";
import { selectPane as selectPadPane } from "../session-store";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { appRoot } from "../../../app/dom-root";

const { setLang } = await import("../../../lib/i18n");
const { clearNotice } = await import("../../../app/notices-store");
const { clearModifiers, pressModifier, withModifiers } = await import("../keypad/keypad.ts");
const { selectPadKind } = await import("./slash-pad.ts");
const { keysExpanded, padKind, setKeysExpanded, setPadKind } = await import("../../settings/preferences-store.ts");
const { SessionKeyPad, SessionSlashPad } = await import("./session-dock.tsx");
const pad = await Bun.file(new URL("./slash-pad.ts", import.meta.url)).text();
const keypad = await Bun.file(new URL("./session-keypad.tsx", import.meta.url)).text();
const compose = await Bun.file(new URL("./compose.ts", import.meta.url)).text();
const slashView = await Bun.file(new URL("./session-slash-pad.tsx", import.meta.url)).text();

beforeEach(async () => {
  await resetBoardTestDOM();
  unmountReact();
  appRoot().replaceChildren();
  setLang("zh");
  clearNotice();
});

afterEach(async () => {
  unmountReact();
  clearModifiers();
  setKeysExpanded(false);
  setPadKind("keys");
  clearNotice();
  appRoot().replaceChildren();
});

describe("expanded pad modes", () => {
  test("the switcher only appears once the pad is expanded", async () => {
    setKeysExpanded(false);
    renderReact(createElement(SessionKeyPad));
    expect(appRoot().querySelector(".pad-mode")).toBeNull();
    expect(appRoot().querySelector(".slash-pad")).toBeNull();
    setKeysExpanded(true);
    renderReact(createElement(SessionKeyPad));
    expect(appRoot().querySelector(".pad-mode")).toBeTruthy();
    expect(keypad).toContain("const expanded = keysExpanded()");
    expect(keypad).toContain("{expanded && <SessionPadModeBar onRepaint={repaint} />}");
    expect(keypad.indexOf("{expanded && <SessionPadModeBar")).toBeGreaterThan(keypad.indexOf("const expanded = keysExpanded()"));
    expect(keypad).toContain("<SessionSlashPad keyItems=");
  });

  test("slash chips fill compose instead of sending keys", async () => {
    seedPadSnapshot({ panes: [{ pane_id: "shortcut-test", agent: "claude" }] });
    selectPadPane("shortcut-test");
    const tokens: string[] = [];
    renderReact(createElement(SessionSlashPad, { onSelect: (text: string) => tokens.push(text) }));
    const chip = appRoot().querySelector<HTMLButtonElement>(".slash-cmd")!;
    act(() => { chip.click(); });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.startsWith("/")).toBeTrue();
    expect(slashView).toContain("setComposeText");
    expect(slashView).toContain("onSelect(command.token)");
    expect(slashView).not.toContain("queueKey");
    expect(slashView).not.toContain("sendPad");
    expect(compose).toContain("export function setComposeText");
  });

  test("switching morphs the expanded body and drops latched modifiers", () => {
    setPadKind("keys");
    pressModifier("ctrl");
    let painted = 0;
    selectPadKind("slash", () => { painted++; });
    expect(padKind()).toBe("slash");
    expect(painted).toBe(1);
    expect(withModifiers("c")).toEqual(["c"]);
    expect(pad).toContain("clearModifiers()");
    expect(pad).toContain("setPadKind(kind)");
    expect(slashView).toContain('t("slash.keys")');
    expect(slashView).toContain('t("slash.commandsShort")');
  });
});
test("a pinned prompt leaves live input and fills the guided draft without sending", async () => {
  const { setQuickCommands, resetPreferences } = await import("../../settings/preferences-store");
  const { composeDraft, composeLive, setComposeLive } = await import("../compose-store");
  const { SessionDock } = await import("./session-dock");
  const { attachLiveSession } = await import("../../computers/catalog-store");
  const sent: string[] = [];
  try {
    attachLiveSession({ sendText: async (_pane: string, text: string) => { sent.push(text); } } as never);
    selectPadPane("prompt-pane");
    setQuickCommands([{ id: "review", label: "Review", text: "Review my changes", pinned: true }]);
    setKeysExpanded(true); setPadKind("slash"); setComposeLive(true);
    renderReact(createElement(SessionDock, { includeBack: true }));
    await act(async () => { appRoot().querySelector<HTMLButtonElement>(".quick-cmd")!.click(); });
    expect(composeLive()).toBe(false);
    expect(composeDraft()).toBe("Review my changes");
    expect(appRoot().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Review my changes");
    expect(sent).toEqual([]);
  } finally { unmountReact(); attachLiveSession(null); resetPreferences(); localStorage.removeItem("pairfob:quickCommands"); }
});
