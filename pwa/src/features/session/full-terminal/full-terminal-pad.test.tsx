import { applySnapshot as seedPadSnapshot } from "../../dashboard/catalog-store";
import { selectPane as selectPadPane } from "../session-store";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { appRoot } from "../../../app/dom-root";
import { keysExpanded, padKind, phoneKeysShown, setKeysExpanded, setPadKind, setPhoneKeysShown } from "../../settings/preferences-store";
import { composeDraft, setComposeDraft, setComposeFocused, setComposeIME, setComposeLive } from "../compose-store";
const { SLASH_COMMANDS } = await import("../../../lib/slash-commands");
const { notifyFullTerminalKeyboard } = await import("./full-terminal-input");
const { clearModifiers, pressModifier, releaseModifier } = await import("../keypad/keypad");
const { FullTerminalPad } = await import("./full-terminal-pad");
const padSource = await Bun.file(new URL("./full-terminal-pad.tsx", import.meta.url)).text();

function kindOption(label: "按键" | "命令"): HTMLButtonElement {
  return [...appRoot().querySelectorAll<HTMLButtonElement>(".pad-kind-option")].find((el) => el.textContent === label)!;
}

function keyboard() {
  let open = false;
  return {
    toggle: () => { open = !open; },
    open: () => { open = true; },
    close: () => { open = false; },
    isOpen: () => open,
  };
}

// Isolated single-component boundary via the shared harness: renderReact mounts
// one FullTerminalPad in its own root; unmountReact releases it. Never the App.
function paint(sendKey: (key: string) => void = () => undefined, sendCompose: (text: string, enter: boolean) => boolean = () => true, desk = false) {
  const options = { sendKey, sendCompose, keyboard: keyboard(), desk };
  renderReact(createElement(FullTerminalPad, { options }));
  return options;
}

let savedMedia: { window: typeof window.matchMedia; global: typeof globalThis.matchMedia } | null = null;

function restoreDevice(): void {
  if (!savedMedia) return;
  delete (navigator as unknown as Record<string, unknown>).maxTouchPoints;
  window.matchMedia = savedMedia.window;
  globalThis.matchMedia = savedMedia.global;
  savedMedia = null;
}

function stubDevice(phone: boolean): void {
  savedMedia ??= { window: window.matchMedia, global: globalThis.matchMedia };
  const coarse = phone;
  const desk = !phone;
  const media = (query: string) => ({
    matches: query === "(pointer: coarse)" ? coarse : query === "(min-width: 900px)" ? desk : false,
  });
  Object.defineProperty(navigator, "maxTouchPoints", { value: phone ? 5 : 0, configurable: true });
  Object.defineProperty(window, "matchMedia", { value: media, configurable: true });
  Object.defineProperty(globalThis, "matchMedia", { value: media, configurable: true, writable: true });
}

const keyLabels = () => [...appRoot().querySelectorAll(".keys button")].map((el) => el.getAttribute("aria-label"));
const phoneToggles = () => appRoot().querySelectorAll(".full-terminal-phone-keys");

beforeEach(async () => { await resetBoardTestDOM(); });

afterEach(async () => {
  unmountReact();
  await act(async () => {
    notifyFullTerminalKeyboard(false);
    clearModifiers();
    setComposeDraft("");
    setComposeFocused(false);
    setComposeIME(false);
    setComposeLive(false);
    setKeysExpanded(false);
    setPhoneKeysShown(false);
    setPadKind("keys");
    restoreDevice();
  });
});

describe("React full-terminal pad", () => {
  test("does not use guided queueKey and routes pad keys through sendKey", async () => {
    expect(padSource).not.toMatch(/\bqueueKey\b/);
    expect(padSource).toContain("withModifiers");
    expect(padSource).toContain("optionsRef.current.sendKey");
    const sent: string[] = [];
    await act(() => { paint((key) => sent.push(key)); });
    const up = appRoot().querySelector('[aria-label="上箭头"]') as HTMLButtonElement;
    const view = appRoot().ownerDocument.defaultView!;
    await act(() => { up.dispatchEvent(new view.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })); });
    expect(sent).toEqual(["up"]);
  });

  test("shows esc and arrows, then more keys after expand, without remounting compose", async () => {
    setKeysExpanded(false);
    setComposeDraft("draft");
    await act(() => { paint(); });
    const input = appRoot().querySelector("textarea")!;
    await act(() => {
      input.focus();
      input.setSelectionRange(1, 3);
    });
    const labels = [...appRoot().querySelectorAll("button")].map((el) => el.getAttribute("aria-label") || el.textContent);
    expect(labels.slice(0, 6)).toEqual(["Esc", "上箭头", "下箭头", "左箭头", "右箭头", "退格"]);
    const more = appRoot().querySelector<HTMLButtonElement>(".key-more")!;
    const view = appRoot().ownerDocument.defaultView!;
    const down = new view.PointerEvent("pointerdown", { button: 0, cancelable: true });
    await act(() => { more.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true);
    await act(() => { more.click(); });
    expect(keysExpanded()).toBe(true);
    expect(appRoot().querySelector("textarea") === input).toBeTrue();
    expect(document.activeElement === input).toBeTrue();
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    expect(appRoot().querySelector('[aria-label="Ctrl+C"]')).toBeTruthy();
    expect(appRoot().querySelector('[aria-label="Alt / Option"]')?.textContent).toBe("Alt");
    expect(appRoot().textContent).not.toContain("Opt");
    expect(appRoot().textContent).not.toContain("换行");
    expect(kindOption("按键").getAttribute("aria-pressed")).toBe("true");
  });

  test("expanded commands fill compose in batch and send text without Enter in live", async () => {
    seedPadSnapshot({ panes: [{ pane_id: "shortcut-test", agent: "claude" }] });
    selectPadPane("shortcut-test");
    act(() => { setKeysExpanded(true); setPadKind("keys"); });
    const sent: Array<[string, boolean]> = [];
    const options = { sendKey: () => undefined, sendCompose: (text: string, enter: boolean) => { sent.push([text, enter]); return true; }, keyboard: keyboard(), desk: false };
    renderReact(createElement(FullTerminalPad, { options }));
    await act(() => { kindOption("命令").click(); });
    expect(padKind()).toBe("slash");
    expect(kindOption("命令").getAttribute("aria-pressed")).toBe("true");
    expect([...appRoot().querySelectorAll(".slash-cmd")].map((el) => el.textContent)).toEqual(SLASH_COMMANDS.map((c) => c.label));
    await act(() => { (appRoot().querySelector('[aria-label="插入 /goal，接着填目标"]') as HTMLButtonElement).click(); });
    expect(composeDraft()).toBe("/goal ");
    expect((appRoot().querySelector(".full-terminal-compose-input") as HTMLTextAreaElement).value).toBe("/goal ");
    expect(sent).toEqual([]);

    act(() => { setComposeLive(true); });
    renderReact(createElement(FullTerminalPad, { options }));
    await act(() => { (appRoot().querySelector('[aria-label="插入 /clear"]') as HTMLButtonElement).click(); });
    expect(sent).toEqual([["/clear", false]]);
  });

  test("live keyboard is a named control and updates from notifyFullTerminalKeyboard", async () => {
    act(() => { setComposeLive(true); });
    const kb = keyboard();
    const options = { sendKey: () => undefined, sendCompose: () => true, keyboard: kb, desk: false };
    renderReact(createElement(FullTerminalPad, { options }));
    const button = appRoot().querySelector(".full-terminal-kb") as HTMLButtonElement;
    expect(button.textContent).toBe("点这里输入");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    const view = appRoot().ownerDocument.defaultView!;
    await act(() => {
      button.dispatchEvent(new view.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(kb.isOpen()).toBe(true);
    expect(button.textContent).toBe("收起键盘");
    await act(() => { kb.close(); notifyFullTerminalKeyboard(false); });
    expect(button.textContent).toBe("点这里输入");
    expect((appRoot().querySelector(".full-terminal-compose-form")) === null).toBeTrue();
  });

  test("unmount destroys pad press so a detached key cannot stay pressed", async () => {
    await act(() => { paint(); });
    const esc = [...appRoot().querySelectorAll("button")].find((el) => el.textContent === "Esc") as HTMLButtonElement;
    const view = appRoot().ownerDocument.defaultView!;
    unmountReact();
    esc.dispatchEvent(new view.PointerEvent("pointerdown", { button: 0, cancelable: true }));
    expect(esc.classList.contains("is-pressed")).toBe(false);
  });
});


test("Alt then arrow reaches the full terminal as one complete chord", async () => {
  const sent: string[] = [];
  paint(key => sent.push(key));
  await act(async () => {
    pressModifier("alt"); releaseModifier("alt");
    appRoot().querySelector<HTMLButtonElement>('[aria-label="上箭头"]')!.click();
  });
  expect(sent).toEqual(["alt+up"]);
});

test("second key page sends literal choices without Enter and editing chords intact", async () => {
  const sent: string[] = [];
  setKeysExpanded(true);
  setPadKind("keys");
  await act(() => { paint(key => sent.push(key)); });
  await act(() => { (appRoot().querySelectorAll<HTMLButtonElement>(".pad-page-dot")[1])!.click(); });
  expect(appRoot().querySelectorAll(".pad-page .key")).toHaveLength(14);
  for (const name of ["Ctrl+Y", "Alt+B", "1", "Y", "N", "空格"]) {
    await act(() => { appRoot().querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click(); });
  }
  expect(sent).toEqual(["ctrl+y", "alt+b", "1", "y", "n", "space"]);
});

test("custom prompts fill and focus a draft in both input modes without transmitting", async () => {
  const { setQuickCommands, resetPreferences } = await import("../../settings/preferences-store");
  const { composeLive } = await import("../compose-store");
  const sent: Array<[string, boolean]> = [];
  try {
    setQuickCommands([{ id: "custom", label: "Custom", text: "Review this change", pinned: true }]);
    setKeysExpanded(true);
    setPadKind("slash");
    setComposeLive(true);
    await act(() => { paint(() => undefined, (text, enter) => { sent.push([text, enter]); return true; }); });
    await act(() => { appRoot().querySelector<HTMLButtonElement>(".quick-cmd")!.click(); });
    expect(composeLive()).toBe(false);
    expect(composeDraft()).toBe("Review this change");
    const field = appRoot().querySelector<HTMLTextAreaElement>("textarea")!;
    expect(field.value).toBe("Review this change");
    expect(document.activeElement).toBe(field);
    await act(() => { setQuickCommands([{ id: "custom", label: "Custom", text: "Next draft", pinned: true }]); });
    await act(() => { appRoot().querySelector<HTMLButtonElement>(".quick-cmd")!.click(); });
    // A saved command goes in at the caret; it never replaces the draft.
    expect(field.value).toBe("Review this change Next draft");
    expect(sent).toEqual([]);
  } finally { resetPreferences(); localStorage.removeItem("pairfob:quickCommands"); }
});

describe("phone key panel", () => {
  test("new: phone pad starts collapsed behind one toggle", async () => {
    stubDevice(true);
    await act(() => { paint(); });
    expect(appRoot().querySelector(".keys")).toBeNull();
    expect(appRoot().querySelector(".pad-kind-option")).toBeNull();
    expect(phoneToggles().length).toBe(1);
    const toggle = phoneToggles()[0] as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(() => { toggle.click(); });
    expect(appRoot().querySelector(".keys")).toBeTruthy();
    expect(phoneKeysShown()).toBe(true);
    expect(phoneToggles().length).toBe(1);
    expect(phoneToggles()[0]!.getAttribute("aria-expanded")).toBe("true");
  });

  test("new: phone pad expanded equals today's", async () => {
    stubDevice(false);
    await act(() => { paint(); });
    const desktop = keyLabels();
    unmountReact();
    stubDevice(true);
    act(() => { setPhoneKeysShown(true); });
    await act(() => { paint(); });
    expect(desktop.length).toBeGreaterThan(0);
    expect(keyLabels()).toEqual(desktop);
    await act(() => { appRoot().querySelector<HTMLButtonElement>(".key-more")!.click(); });
    expect(keysExpanded()).toBe(true);
    expect(appRoot().querySelector('[aria-label="Ctrl+C"]')).toBeTruthy();
  });

  test("new: desktop pad has no phone toggle", async () => {
    stubDevice(false);
    await act(() => { paint(); });
    expect(phoneKeysShown()).toBe(false);
    expect(appRoot().querySelector(".keys")).toBeTruthy();
    expect(phoneToggles().length).toBe(0);
  });
});
