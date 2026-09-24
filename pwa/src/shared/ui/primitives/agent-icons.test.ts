import { describe, expect, test } from "bun:test";
import { AGENT_ICONS, agentIcon } from "./agent-icons";

describe("agent marks", () => {
  test("advertised kinds and their common aliases resolve to one mark", () => {
    expect(agentIcon("claude")).toBe(AGENT_ICONS.claude);
    expect(agentIcon("Claude-Code")).toBe(AGENT_ICONS.claude);
    expect(agentIcon("codex")).toBe(AGENT_ICONS.codex);
    expect(agentIcon("cursor-agent")).toBe(AGENT_ICONS.cursor);
    expect(agentIcon("qwen-code")).toBe(AGENT_ICONS.qwen);
    expect(agentIcon(" gemini ")).toBe(AGENT_ICONS.gemini);
    expect(agentIcon("pi")).toBe(AGENT_ICONS.pi);
    expect(agentIcon("agy")).toBe(AGENT_ICONS.antigravity);
    expect(agentIcon("roo-code")).toBe(AGENT_ICONS.roocode);
    expect(agentIcon("kilo")).toBe(AGENT_ICONS.kilocode);
  });

  test("an unknown kind or a plain terminal has no mark, so a monogram stands in", () => {
    expect(agentIcon("aider")).toBeNull();
    expect(agentIcon("")).toBeNull();
    expect(agentIcon("droid")).toBeNull();
  });

  test("bundled marks are inert path markup: no ids, scripts, links or external references", () => {
    for (const [kind, spec] of Object.entries(AGENT_ICONS)) {
      expect(spec.body, kind).not.toMatch(/<script|\son\w+=|\sid=|href|url\(|<image|<foreignObject/i);
      expect(spec.body, kind).toMatch(/^<(path|g)[\s>]/);
    }
  });
});
