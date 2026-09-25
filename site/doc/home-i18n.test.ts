import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CJK = /[一-鿿]/;
const siteRoot = fileURLToPath(new URL("..", import.meta.url));
const source = await Bun.file(new URL("../home-i18n.js", import.meta.url)).text();
const html = await Bun.file(new URL("../index.html", import.meta.url)).text();

function table(name: "zh" | "en"): Record<string, string> {
  const start = source.indexOf(`const ${name} = {`);
  const end = source.indexOf("\n  };", start);
  if (start < 0 || end < 0) throw new Error(`missing ${name} table`);
  const objectLiteral = source.slice(source.indexOf("{", start), end + 4);
  return Function(`"use strict"; return (${objectLiteral})`)() as Record<string, string>;
}

function normalize(value: string): string {
  return value.replace(/<br\s*\/?>/g, "<br />").replace(/\s+/g, " ").trim();
}

/** The inner HTML of every element carrying data-i18n, nested markup included. */
function i18nFallbacks(doc: string): Array<{ key: string; inner: string }> {
  const out: Array<{ key: string; inner: string }> = [];
  const open = /<([a-z][a-z0-9]*)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(doc))) {
    const [tag, name, key] = [match[0], match[1], match[2]];
    const same = new RegExp(`<${name}\\b[^>]*>|</${name}>`, "g");
    same.lastIndex = match.index + tag.length;
    let depth = 1;
    let end = -1;
    let step: RegExpExecArray | null;
    while ((step = same.exec(doc))) {
      depth += step[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = step.index;
        break;
      }
    }
    if (end < 0) throw new Error(`unclosed <${name}> for ${key}`);
    out.push({ key, inner: doc.slice(match.index + tag.length, end) });
  }
  return out;
}

function usedKeys(doc: string): string[] {
  const keys = new Set<string>();
  for (const m of doc.matchAll(/data-i18n(?:-aria|-alt)?="([^"]+)"/g)) keys.add(m[1]);
  return [...keys];
}

describe("homepage i18n", () => {
  const zh = table("zh");
  const en = table("en");

  test("zh and en share the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  test("every key the page uses exists in both tables", () => {
    const missing = usedKeys(html).filter((key) => !(key in en) || !(key in zh));
    expect(missing).toEqual([]);
  });

  test("English copy has no leftover Chinese", () => {
    const leftover: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      if (CJK.test(value)) leftover.push(key);
    }
    expect(leftover).toEqual([]);
  });

  test("static HTML keeps Chinese only on the language switcher", () => {
    const withoutSwitcher = html.replace(/<button[^>]*data-lang="zh"[^>]*>中文<\/button>/, "");
    expect(CJK.test(withoutSwitcher)).toBe(false);
  });

  test("static HTML fallbacks match English copy", () => {
    const drift: string[] = [];
    for (const { key, inner } of i18nFallbacks(html)) {
      const expected = en[key];
      if (expected === undefined) drift.push(`${key} missing from en`);
      else if (normalize(inner) !== normalize(expected)) drift.push(key);
    }
    expect(drift).toEqual([]);
  });

  test("homepage copy does not mention Markdown rendering", () => {
    expect(source.toLowerCase()).not.toContain("markdown");
    expect(html.toLowerCase()).not.toContain("markdown");
  });

  test("homepage sends visitors to the direct pairing instructions", () => {
    expect(html).toContain('class="btn btn-dark bar-cta cta-desk" href="#how"');
    expect(html).toContain('class="btn btn-dark cta-desk" href="#how"');
    expect(html).toContain('class="btn btn-dark bar-cta cta-phone" href="/doc/start"');
    expect(html).not.toContain('href="/pair"');
    expect(html).not.toContain('data-copy="https://pairfob.com/pair"');
    expect(zh["s3.hint"]).toContain("完整链接");
    expect(en["cta.start"]).toBe("Get started");
    expect(zh["cta.start"]).toBe("开始使用");
  });

  test("phone visitors get a same-tab setup guide in the hero, how-to and closing bands", () => {
    expect(html).toMatch(/class="btn btn-dark cta-phone" href="\/doc\/start"/);
    expect(html).toMatch(/class="step-open cta-phone"><a class="btn btn-dark" href="\/doc\/start"/);
    expect(html).toMatch(/class="cta-phone close-open"><a class="btn btn-dark" href="\/doc\/start"/);
    expect(html).not.toMatch(/href="\/doc\/start"[^>]*target="_blank"/);
    expect(html).toContain('class="step-host-note" data-i18n="how.p"');
    expect(zh["how.p"]).toContain("电脑终端");
    expect(en["how.p"]).toContain("terminal on the computer");
  });

  test("homepage exposes a GitHub issue channel", () => {
    const issues = "https://github.com/arronKler/pairfob/issues/new";
    expect(html).toContain(issues);
    expect(html).toMatch(/href="https:\/\/github.com\/arronKler\/pairfob\/issues\/new"[^>]*data-i18n="nav.feedback"/);
    expect(html).toContain('class="faq-feedback" data-i18n="faq.feedback"');
    expect(zh["faq.feedback"]).toContain(issues);
    expect(en["faq.feedback"]).toContain(issues);
    expect(zh["nav.feedback"]).toBe("反馈");
    expect(en["nav.feedback"]).toBe("Feedback");
    expect(zh["faq.feedback"]).toContain("GitHub");
    expect(en["faq.feedback"]).toContain("GitHub");
  });

  test("homepage header links to the public GitHub repository", () => {
    expect(html).toMatch(/class="bar-github"[^>]*href="https:\/\/github.com\/arronKler\/pairfob"/);
    expect(html).toContain('data-i18n-aria="nav.github"');
    expect(html).toContain('"codeRepository": "https://github.com/arronKler/pairfob"');
    expect(en["nav.github"]).toBe("Source on GitHub");
    expect(zh["nav.github"]).toBe("GitHub 上的源码");
  });

  test("homepage paid FAQ is a short no, not a policy paragraph", () => {
    expect(en["faq.q6"]).toBe("Does it cost money?");
    expect(en["faq.a6"]).toBe("No.");
    expect(zh["faq.q6"]).toBe("收费吗？");
    expect(zh["faq.a6"]).toBe("不收费。");
    expect(en["faq.a6"]).not.toContain("official instance");
    expect(zh["faq.a6"]).not.toContain("官方实例");
    expect(en["foot.blurb"]).not.toContain("official instance");
    expect(zh["foot.blurb"]).not.toContain("官方实例");
    expect(en["hero.sub"]).not.toContain("screenshot");
    expect(zh["hero.sub"]).not.toContain("截图");
    expect(en.description).toContain("Tailscale network");
    expect(zh.description).toContain("Tailscale");
    expect(html).toContain(en.description);
  });

  test("the security band describes the direct Tailscale route", () => {
    expect(html).toContain('class="route route-p2p"');
    expect(html).not.toContain('class="route route-relay"');
    expect(en["safe.p"]).toContain("does not relay this connection");
    expect(zh["safe.p"]).toContain("不通过 pairfob.com 中转");
    expect(en["safe.fine"]).toContain("HTTP");
    expect(zh["safe.fine"]).toContain("HTTP");
  });
});

describe("homepage assets and CSP", () => {
  test("every product still exists for both locales", () => {
    const missing: string[] = [];
    for (const m of html.matchAll(/<img[^>]*\ssrc="([^"]+)"[^>]*\sdata-src-zh="([^"]+)"/g)) {
      const [en, zh] = [m[1], m[2]];
      if (!en.startsWith("/img/home/en/") || !zh.startsWith("/img/home/zh/")) missing.push(`${en} | ${zh}`);
      for (const path of [en, zh]) if (!existsSync(siteRoot + path.slice(1))) missing.push(path);
    }
    expect(missing).toEqual([]);
    expect(html.match(/data-src-zh=/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });

  test("markup stays inside the site CSP (no inline script or style)", () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/<style[\s>]/);
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].map((m) => m[1].trim());
    expect(inline).toEqual(['type="application/ld+json"']);
    expect(html).not.toMatch(/\son[a-z]+="/);
  });
});
