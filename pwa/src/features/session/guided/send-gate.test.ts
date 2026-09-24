import { afterEach, describe, expect, test } from "bun:test";
import type { SendAttachmentsState } from "../attachments/attachments-send";
const { selectPane } = await import("../session-store");
const { attachmentMessage, cancelSendWait, dismissSendIssue, requestSend, resetSendGate, sendGateSnapshot } = await import("./send-gate");

const state = (patch: Partial<SendAttachmentsState>): SendAttachmentsState => ({
  readyPaths: [], pending: 0, pendingPercent: 100, blocked: 0, blockedNames: [], waitingP2P: false, total: 0, ...patch,
});

afterEach(() => {
  resetSendGate();
  selectPane("");
});

describe("attachment message", () => {
  test("draft, a blank line, then one path per line in tray order", () => {
    expect(attachmentMessage("compare these", ["/w/a.png", "/w/b.png"])).toBe("compare these\n\n/w/a.png\n/w/b.png");
  });

  test("attachments alone are a message; no paths leaves the draft untouched", () => {
    expect(attachmentMessage("", ["/w/a.png"])).toBe("/w/a.png");
    expect(attachmentMessage("  \n", ["/w/a.png"])).toBe("/w/a.png");
    expect(attachmentMessage("line one\n", [])).toBe("line one\n");
    expect(attachmentMessage("trailing  \n\n", ["/w/a.png"])).toBe("trailing\n\n/w/a.png");
  });
});

describe("send gate", () => {
  test("ready attachments send immediately with their paths", async () => {
    const runs: string[][] = [];
    await requestSend((paths) => { runs.push([...paths]); }, state({ readyPaths: ["/w/a.png"], total: 1 }));
    expect(runs).toEqual([["/w/a.png"]]);
    expect(sendGateSnapshot()).toEqual({ waiting: false, issue: false });
  });

  test("running uploads wait instead of sending; cancelling drops the pending send", () => {
    const runs: string[][] = [];
    selectPane("p1");
    requestSend((paths) => { runs.push([...paths]); }, state({ pending: 1, pendingPercent: 40, total: 1 }));
    expect(runs).toEqual([]);
    expect(sendGateSnapshot().waiting).toBeTrue();
    cancelSendWait();
    expect(sendGateSnapshot().waiting).toBeFalse();
    expect(runs).toEqual([]);
  });

  test("blocked items ask first and never send silently", () => {
    const runs: string[][] = [];
    requestSend((paths) => { runs.push([...paths]); }, state({ blocked: 1, blockedNames: ["trace.log"], total: 1 }));
    expect(sendGateSnapshot().issue).toBeTrue();
    expect(runs).toEqual([]);
    dismissSendIssue();
    expect(sendGateSnapshot().issue).toBeFalse();
    expect(runs).toEqual([]);
  });
});
