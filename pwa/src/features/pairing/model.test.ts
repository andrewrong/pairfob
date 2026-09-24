import { describe, expect, test } from "bun:test";
import { setLang } from "../../lib/i18n";
import { connectViewModel, formatPairCodeDraft } from "./model";

const empty = {
  phase: "connect",
  addingComputer: false,
  computerCount: 0,
  fragment: null,
  pairCodeDraft: "",
  pairManualOpen: false,
  pairErrorTarget: null as "code" | null,
  pairFailedStep: null,
  pairAwaitingApproval: false,
  notice: null,
  desk: false,
};

describe("connect view model", () => {
  test("first pairing and add-computer share one skeleton; only the chrome differs", () => {
    setLang("zh");
    const first = connectViewModel(empty);
    expect(first.stage).toBe("idle");
    expect(first.title).toBe("连上你的电脑");
    expect(first.adding).toBeFalse();
    expect(first.showInstall).toBeTrue();
    const add = connectViewModel({ ...empty, addingComputer: true });
    expect(add.stage).toBe("idle");
    expect(add.backTitle).toBe("添加电脑");
    expect(add.title).toBe(first.title);
    expect(add.lede).toContain("pairfob pair");
  });

  test("the handshake stages swap copy and hide the sheet", () => {
    setLang("zh");
    const connecting = connectViewModel({ ...empty, phase: "pairing", pairManualOpen: true });
    expect(connecting.stage).toBe("connecting");
    expect(connecting.busy).toBeTrue();
    expect(connecting.sheetOpen).toBeFalse();
    const approve = connectViewModel({ ...empty, phase: "pairing", pairAwaitingApproval: true });
    expect(approve.stage).toBe("approve");
    expect(approve.title).toContain("Enter");
    expect(approve.ledeKeycap).toBeTrue();
    expect(approve.lede).toContain("{key}");
  });

  test("a step failure lands on the page; a code failure stays on the field", () => {
    setLang("zh");
    const notice = { text: "电脑上没有确认。", tone: "error" as const };
    const failed = connectViewModel({ ...empty, pairFailedStep: "verify", notice });
    expect(failed.stage).toBe("failed");
    expect(failed.lede).toBe("电脑上没有确认。");
    expect(failed.ledeTone).toBe("error");
    const code = connectViewModel({ ...empty, pairFailedStep: "code", pairErrorTarget: "code", pairManualOpen: true, notice });
    expect(code.stage).toBe("idle");
    expect(code.sheetNotice).toEqual(notice);
    expect(code.pairCodeInvalid).toBeTrue();
    expect(code.lede).not.toBe(notice.text);
  });

  test("an incomplete code is not marked complete; typing groups it 4-4-6", () => {
    const draft = connectViewModel({ ...empty, pairCodeDraft: "ABCD-EFGH" });
    expect(draft.pairCodeLength).toBe(8);
    expect(draft.pairCodeComplete).toBeFalse();
    expect(formatPairCodeDraft("7k3m9h2pwj3k9m")).toBe("7K3M-9H2P-WJ3K9M");
    expect(formatPairCodeDraft("7k3mo")).toBe("7K3M-0");
    expect(formatPairCodeDraft("https://pairfob.com/pair#c=1")).toBe("https://pairfob.com/pair#c=1");
  });
});
