import { beforeEach, expect, test } from "bun:test";
import {
  cacheAgentTrace,
  cacheAgentTraceViewport,
  cachedAgentTrace,
  clearAgentTraceCache,
} from "./agent-trace-cache";

beforeEach(clearAgentTraceCache);

const entry = {
  items: [{ type: "assistant" as const, text: "cached" }],
  nextCursor: null,
  note: "",
  truncated: false,
  signature: "cached",
  tail: 1,
};

test("owner-keyed viewport metadata is copied and rejected for a replacement occupant", () => {
  cacheAgentTrace("p1", { ...entry, ownerKey: "daemon:session:p1:instance-a" });
  const viewport = { anchor: "turn-a", offset: -12, scrollTop: 320, follow: false, unread: true };
  cacheAgentTraceViewport("p1", "daemon:session:p1:instance-a", viewport);
  viewport.scrollTop = 999;

  const cached = cachedAgentTrace("p1", "daemon:session:p1:instance-a");
  expect(cached?.viewport).toEqual({ anchor: "turn-a", offset: -12, scrollTop: 320, follow: false, unread: true });
  expect(cachedAgentTrace("p1", "daemon:session:p1:instance-b")).toBeNull();
});

test("legacy entries without viewport metadata remain readable", () => {
  cacheAgentTrace("p1", entry);
  expect(cachedAgentTrace("p1", "new-owner")?.items).toEqual(entry.items);
});
