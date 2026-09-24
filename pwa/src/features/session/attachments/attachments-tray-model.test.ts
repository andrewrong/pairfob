import { describe, expect, test } from "bun:test";
import type { AttachmentItem } from "./attach-model";
import { inBody, keepsOriginal, summarizeForSend, trayActions, trayPhase, type TrayContext } from "./attachments-tray-model";

const READY: TrayContext = { p2pReady: true, draft: "" };
const RELAY: TrayContext = { p2pReady: false, draft: "" };
const PATH = "/repo/.pairfob/attachments/aa/shot.png";

function item(patch: Partial<AttachmentItem> = {}): AttachmentItem {
  return {
    localId: "a", kind: "file", name: "notes.txt", size: 100, mime: "text/plain", status: "queued",
    acknowledged: 0, errorText: "", recoverable: false, path: "", inserted: false, editNote: "",
    cancelIntent: false, ...patch,
  };
}

describe("tray phase", () => {
  test("every status maps to one visual state", () => {
    expect(trayPhase(item({ status: "committed", path: PATH }), READY)).toBe("ready");
    expect(trayPhase(item({ status: "uploading" }), READY)).toBe("uploading");
    expect(trayPhase(item({ status: "preparing" }), READY)).toBe("processing");
    expect(trayPhase(item({ status: "cancelling" }), READY)).toBe("processing");
    expect(trayPhase(item({ status: "queued", scheduled: true }), RELAY)).toBe("processing");
    expect(trayPhase(item({ status: "error", recoverable: true }), READY)).toBe("paused");
    expect(trayPhase(item({ status: "error" }), READY)).toBe("failed");
    expect(trayPhase(item({ status: "error", recoverable: true, cancelIntent: true }), READY)).toBe("failed");
    expect(trayPhase(item({ status: "cancelled" }), READY)).toBe("failed");
  });

  test("a fresh queued row waits for P2P; a restored one waits for the reader", () => {
    expect(trayPhase(item(), RELAY)).toBe("waiting");
    expect(trayPhase(item({ transferPhase: "waiting-p2p" }), RELAY)).toBe("waiting");
    expect(trayPhase(item(), READY)).toBe("processing");
    expect(trayPhase(item({ restored: true }), READY)).toBe("paused");
    expect(trayPhase(item({ restored: true }), RELAY)).toBe("paused");
  });
});

describe("in-body paths", () => {
  test("count only while the path is still written in the draft", () => {
    const row = item({ status: "committed", path: PATH, inserted: true });
    expect(inBody(row, `compare ${PATH} with the log`)).toBe(true);
    // The reader deleted the path by hand: it is appended on send again.
    expect(inBody(row, "compare with the log")).toBe(false);
    expect(inBody({ ...row, inserted: false }, PATH)).toBe(false);
  });
});

describe("action bar", () => {
  const facts = { hasHandle: false };

  test("lists only what applies, the recovery step first", () => {
    expect(trayActions(item(), RELAY, facts)).toEqual(["connect", "preview", "remove"]);
    expect(trayActions(item({ status: "error", recoverable: true }), READY, { hasHandle: true }))
      .toEqual(["resume", "preview", "remove"]);
    expect(trayActions(item({ status: "error", errorText: "boom" }), READY, facts)).toEqual(["retry", "preview", "remove"]);
    expect(trayActions(item({ status: "error" }), READY, { hasHandle: true })).toEqual(["check", "preview", "remove"]);
    expect(trayActions(item({ status: "uploading" }), READY, { hasHandle: true })).toEqual(["preview", "remove"]);
    expect(trayActions(item({ status: "committed", path: PATH }), READY, facts)).toEqual(["preview", "toBody", "remove"]);
  });

  test("images offer the other quality only while settled and not in the body", () => {
    const image = item({ kind: "image", name: "a.jpg", mime: "image/jpeg", compressionMode: "smart" });
    expect(trayActions(image, RELAY, facts)).toContain("toOriginal");
    expect(trayActions({ ...image, compressionMode: "original" }, RELAY, facts)).toContain("toSmart");
    expect(trayActions({ ...image, status: "uploading" }, READY, facts)).not.toContain("toOriginal");
    const ready = { ...image, status: "committed" as const, path: PATH };
    expect(trayActions(ready, READY, facts)).toEqual(["preview", "toBody", "toOriginal", "remove"]);
    const body = { ...ready, inserted: true };
    expect(trayActions(body, { p2pReady: true, draft: PATH }, facts)).toEqual(["preview", "fromBody", "remove"]);
  });

  test("the retired text & detail intent reads as the original", () => {
    expect(keepsOriginal(item({ kind: "image", compressionMode: "smart", imageIntent: "detail" }))).toBe(true);
    expect(keepsOriginal(item({ kind: "image" }))).toBe(false);
  });
});

describe("send summary", () => {
  test("ready paths in tray order, minus the ones already in the draft", () => {
    const rows = [
      item({ localId: "1", status: "committed", path: "/w/b.txt" }),
      item({ localId: "2", status: "committed", path: "/w/a.txt", inserted: true }),
      item({ localId: "3", status: "committed", path: "/w/c.txt" }),
    ];
    expect(summarizeForSend(rows, { p2pReady: true, draft: "see /w/a.txt" })).toEqual({
      readyPaths: ["/w/b.txt", "/w/c.txt"], pending: 0, pendingPercent: 100,
      blocked: 0, blockedNames: [], waitingP2P: false, total: 3,
    });
  });

  test("pending rows report their mean progress; blocked rows their names", () => {
    const rows = [
      item({ localId: "1", status: "uploading", size: 100, acknowledged: 50 }),
      item({ localId: "2", status: "preparing" }),
      item({ localId: "3", status: "error", name: "trace.log" }),
    ];
    const summary = summarizeForSend(rows, READY);
    expect(summary).toMatchObject({ pending: 2, pendingPercent: 25, blocked: 1, blockedNames: ["trace.log"], waitingP2P: false });
  });

  test("waitingP2P only when every blocked row just needs the connection", () => {
    expect(summarizeForSend([item({ name: "a" }), item({ localId: "b", name: "b" })], RELAY))
      .toMatchObject({ blocked: 2, waitingP2P: true });
    expect(summarizeForSend([item({ name: "a" }), item({ localId: "b", status: "error" })], RELAY))
      .toMatchObject({ blocked: 2, waitingP2P: false });
    expect(summarizeForSend([item({ restored: true })], RELAY)).toMatchObject({ blocked: 1, waitingP2P: false });
  });
});

describe("taking a path back out of the draft", () => {
  test("removes the first occurrence and one separating space", async () => {
    const { withoutPath } = await import("./attachments-insertion");
    expect(withoutPath(`compare ${PATH} with the log`, PATH)).toBe("compare with the log");
    expect(withoutPath(`look at ${PATH}`, PATH)).toBe("look at");
    expect(withoutPath(PATH, PATH)).toBe("");
    expect(withoutPath("nothing", PATH)).toBe("nothing");
  });
});
