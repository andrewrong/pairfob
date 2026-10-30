import { describe, expect, test } from "bun:test";

import { parseTermMode, resolveTermMode } from "./terminal-mode.ts";

describe("terminal mode policy", () => {
  test("defaults invalid or missing preferences to auto", () => {
    expect(parseTermMode("auto")).toBe("auto");
    expect(parseTermMode("guided")).toBe("guided");
    expect(parseTermMode("full")).toBe("full");
    expect(parseTermMode("agent")).toBe("agent");
    expect(parseTermMode("nope")).toBe("auto");
    expect(parseTermMode(null, "full")).toBe("full");
  });

  test("auto selects terminal only for P2P with full-terminal support", () => {
    expect(resolveTermMode("auto", { p2p: true, fullTerminalAvailable: true, phone: false, agentAvailable: false })).toBe("full");
    expect(resolveTermMode("auto", { p2p: false, fullTerminalAvailable: true, phone: false, agentAvailable: false })).toBe("guided");
    expect(resolveTermMode("auto", { p2p: true, fullTerminalAvailable: false, phone: false, agentAvailable: false })).toBe("guided");
  });

  test("explicit modes override the automatic context", () => {
    const unavailable = { p2p: false, fullTerminalAvailable: false, phone: false, agentAvailable: false };
    expect(resolveTermMode("full", unavailable)).toBe("full");
    expect(resolveTermMode("guided", unavailable)).toBe("guided");
    expect(resolveTermMode("agent", unavailable)).toBe("agent");
  });

  test("new: auto on a phone with an agent resolves to agent", () => {
    expect(resolveTermMode("auto", { p2p: true, fullTerminalAvailable: true, phone: true, agentAvailable: true })).toBe("agent");
  });

  test("new: auto on a phone without an agent resolves to guided", () => {
    expect(resolveTermMode("auto", { p2p: true, fullTerminalAvailable: true, phone: true, agentAvailable: false })).toBe("guided");
    expect(resolveTermMode("auto", { p2p: false, fullTerminalAvailable: true, phone: true, agentAvailable: false })).toBe("guided");
  });

  test("new: an explicit full on a phone stays full", () => {
    const phone = { p2p: true, fullTerminalAvailable: true, phone: true, agentAvailable: true };
    expect(resolveTermMode("full", phone)).toBe("full");
    expect(resolveTermMode("guided", phone)).toBe("guided");
    expect(resolveTermMode("agent", phone)).toBe("agent");
  });

  test("new: desktop auto is unchanged", () => {
    for (const agentAvailable of [true, false]) {
      expect(resolveTermMode("auto", { p2p: true, fullTerminalAvailable: true, phone: false, agentAvailable })).toBe("full");
      expect(resolveTermMode("auto", { p2p: false, fullTerminalAvailable: true, phone: false, agentAvailable })).toBe("guided");
    }
  });
});
