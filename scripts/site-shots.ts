#!/usr/bin/env bun
// Render the homepage product stills in site/img/home/{en,zh}/ from the PWA QA
// fixtures (pwa/qa), so the landing page always shows the real app. Rerun after
// a PWA change that alters these screens:
//
//   bun scripts/site-shots.ts
//
// Needs Google Chrome (override the binary with CHROME=/path/to/chrome). The
// script starts its own PWA dev server and headless Chrome, and stops both.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "site", "img", "home");
const VITE_PORT = Number(process.env.SHOTS_VITE_PORT ?? 5198);
const CDP_PORT = Number(process.env.SHOTS_CDP_PORT ?? 9337);
const SCALE = 1.5;
const LANGS = ["en", "zh"] as const;

type Shot = { name: string; scene: string; width: number; height: number };
const PHONE = { width: 390, height: 844 };
const SHOTS: Shot[] = [
  { name: "connect", scene: "connect", ...PHONE },
  { name: "home-grouped", scene: "home-grouped", ...PHONE },
  { name: "guided-draft", scene: "guided-draft", ...PHONE },
  { name: "guided-expanded", scene: "guided-expanded", ...PHONE },
  { name: "workspace-diff", scene: "workspace-diff", ...PHONE },
  { name: "chat-complete", scene: "chat-complete", ...PHONE },
  { name: "settings", scene: "settings", ...PHONE },
  // iPad landscape: above the PWA's 900px breakpoint, so the two-column desk layout.
  { name: "tablet", scene: "desktop-guided", width: 1180, height: 820 },
];

function chromePath(): string {
  if (process.env.CHROME) return process.env.CHROME;
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return "google-chrome";
}

async function waitFor(url: string, what: string): Promise<Response> {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(250);
  }
  throw new Error(`timed out waiting for ${what} at ${url}`);
}

class Cdp {
  private next = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      const waiter = msg.id ? this.pending.get(msg.id) : undefined;
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    };
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => {
      ws.onopen = ok;
      ws.onerror = () => fail(new Error("CDP connection failed"));
    });
    return new Cdp(ws);
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function capture(cdp: Cdp, lang: string, shot: Shot): Promise<void> {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: SCALE,
      mobile: shot.width < 900,
    }, sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    const url = `http://127.0.0.1:${VITE_PORT}/qa/index.html?lang=${lang}&scene=${shot.scene}`;
    await cdp.send("Page.navigate", { url }, sessionId);
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      const res = await cdp.send("Runtime.evaluate", {
        expression: 'document.documentElement.dataset.qaReady === "true"',
        returnByValue: true,
      }, sessionId);
      ready = res.result?.value === true;
      if (!ready) await Bun.sleep(250);
    }
    if (!ready) throw new Error(`scene ${shot.scene} (${lang}) never became ready`);
    // Let fonts and the settle animation finish before the still is taken.
    await Bun.sleep(900);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "webp", quality: 86 }, sessionId);
    const file = join(OUT, lang, `${shot.name}.webp`);
    await Bun.write(file, Buffer.from(data, "base64"));
    console.log(`wrote ${file.slice(ROOT.length + 1)}`);
  } finally {
    await cdp.send("Target.closeTarget", { targetId });
  }
}

const vite = Bun.spawn(["bunx", "vite", "--port", String(VITE_PORT), "--strictPort"], {
  cwd: join(ROOT, "pwa"),
  stdout: "ignore",
  stderr: "inherit",
});
const profile = await mkdtemp(join(tmpdir(), "pairfob-shots-"));
const chrome = Bun.spawn([
  chromePath(),
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdout: "ignore", stderr: "ignore" });

let cdp: Cdp | undefined;
try {
  await waitFor(`http://127.0.0.1:${VITE_PORT}/qa/index.html`, "the PWA dev server");
  const version = await (await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, "Chrome")).json();
  cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  for (const lang of LANGS) {
    await mkdir(join(OUT, lang), { recursive: true });
    for (const shot of SHOTS) await capture(cdp, lang, shot);
  }
} finally {
  cdp?.close();
  chrome.kill();
  vite.kill();
  await rm(profile, { recursive: true, force: true });
}
