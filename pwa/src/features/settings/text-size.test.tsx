import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { happy, resetTestDOM } from "../../../test-support/boot-dom";
import { setLang } from "../../lib/i18n";
import { emptyEnvironment } from "../../shared/model/domain-environment";
import { SettingsContent } from "../../pages/settings/settings-page";
import { hydratePreferences, resetPreferences } from "./preferences-store";
import { applyTextSize } from "./text-size";

let root: Root | null = null;
let host: HTMLElement | null = null;
const rootSize = () => document.documentElement.style.fontSize;
const reload = () => hydratePreferences(emptyEnvironment({ read: (key) => localStorage.getItem(key) }));

beforeEach(async () => {
  await resetTestDOM();
  localStorage.clear();
  document.documentElement.style.fontSize = "";
  resetPreferences();
  setLang("zh");
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(SettingsContent, { withBack: false })));
}

test("Settings 文字大小 offers four options that set the root font-size and survive a reload", () => {
  mount();
  const item = host!.querySelector(".text-size-item")!;
  expect(item.textContent).toContain("文字大小");
  const buttons = [...item.querySelectorAll("button")];
  expect(buttons.map(b => b.textContent)).toEqual(["小", "标准", "大", "特大"]);
  const expected = ["14px", "16px", "18px", "20px"];
  buttons.forEach((button, i) => {
    act(() => { button.dispatchEvent(new happy.window.MouseEvent("click", { bubbles: true })); });
    expect(rootSize()).toBe(expected[i]);
    resetPreferences();
    reload();
    applyTextSize();
    expect(rootSize()).toBe(expected[i]);
  });
});

test("the default is 16px at 390px wide and 18px at 1024px; a stored choice wins at both", () => {
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
  applyTextSize();
  expect(rootSize()).toBe("16px");
  happy.happyDOM.setWindowSize({ width: 1024, height: 768 });
  applyTextSize();
  expect(rootSize()).toBe("18px");
  localStorage.setItem("pairfob:textSize", "small");
  reload();
  applyTextSize();
  expect(rootSize()).toBe("14px");
  happy.happyDOM.setWindowSize({ width: 390, height: 844 });
  applyTextSize();
  expect(rootSize()).toBe("14px");
});
