import type { SnapshotWire } from "../src/lib/dashboard";

/**
 * A busy computer for the `*-busy` scenes: several workspaces, a dozen agent
 * kinds, plain terminals, long titles and multi-pane tabs. It is separate from
 * the baseline `snapshot()` so saved parity screenshots of the other scenes
 * keep their data.
 */

export const BUSY_AGENT_KINDS = [
  "codex", "claude", "gemini", "copilot", "grok", "pi", "opencode", "cursor", "amp", "kimi", "qwen", "goose",
];

type Pane = {
  id: string;
  tab: string;
  agent: string;
  status: "working" | "blocked" | "done" | "idle" | "unknown";
  label: string;
  /** Terminal title for a plain shell (no agent). */
  title?: string;
  /** Where it runs when not at the workspace root. */
  cwd?: string;
};

type Space = { id: string; label: string; cwd: string; tabs: Array<[string, string]>; panes: Pane[] };

const SPACES: Space[] = [
  { id: "b1", label: "pairfob", cwd: "/work/pairfob",
    tabs: [["b1:t1", "implementation"], ["b1:t2", "tests"], ["b1:t3", "release"]],
    panes: [
      { id: "b1:p1", tab: "b1:t1", agent: "codex", status: "working", label: "Refactor the create sheet" },
      { id: "b1:p2", tab: "b1:t1", agent: "claude", status: "blocked", label: "Review swipe gestures on iOS" },
      { id: "b1:p3", tab: "b1:t1", agent: "", status: "idle", label: "", title: "bun run dev" },
      { id: "b1:p4", tab: "b1:t2", agent: "grok", status: "done", label: "Validate types" },
      { id: "b1:p5", tab: "b1:t2", agent: "gemini", status: "idle", label: "Write QA scenes for the board" },
      { id: "b1:p6", tab: "b1:t3", agent: "", status: "idle", label: "Release checklist", title: "zsh", cwd: "/work/pairfob/scripts" },
    ] },
  { id: "b2", label: "dashboard", cwd: "/work/dashboard",
    tabs: [["b2:t1", "review"], ["b2:t2", "api"]],
    panes: [
      { id: "b2:p1", tab: "b2:t1", agent: "pi", status: "idle", label: "Mobile layout" },
      { id: "b2:p2", tab: "b2:t1", agent: "claude", status: "working", label: "Chart tooltips and keyboard focus" },
      { id: "b2:p3", tab: "b2:t1", agent: "copilot", status: "done", label: "Fix the flaky snapshot test" },
      { id: "b2:p4", tab: "b2:t1", agent: "", status: "idle", label: "", title: "pnpm dev --host" },
      { id: "b2:p5", tab: "b2:t2", agent: "cursor", status: "blocked", label: "Paginate the audit log endpoint" },
    ] },
  { id: "b3", label: "infra", cwd: "~/ops/infra",
    tabs: [["b3:t1", "prod"]],
    panes: [
      { id: "b3:p1", tab: "b3:t1", agent: "opencode", status: "working", label: "Terraform plan for the edge cache" },
      { id: "b3:p2", tab: "b3:t1", agent: "", status: "idle", label: "", title: "kubectl logs -f api-7d9c", cwd: "~/ops/infra/k8s" },
    ] },
  { id: "b4", label: "mobile-app", cwd: "~/work/mobile-app",
    tabs: [["b4:t1", "notifications"], ["b4:t2", "i18n"]],
    panes: [
      { id: "b4:p1", tab: "b4:t1", agent: "kimi", status: "working", label: "Push notification permissions" },
      { id: "b4:p2", tab: "b4:t1", agent: "goose", status: "unknown", label: "Crash triage from last night" },
      { id: "b4:p3", tab: "b4:t2", agent: "qwen", status: "done", label: "Translate onboarding strings" },
    ] },
  { id: "b5", label: "site", cwd: "~/work/site",
    tabs: [["b5:t1", "landing"]],
    panes: [
      { id: "b5:p1", tab: "b5:t1", agent: "amp", status: "idle", label: "Image pipeline" },
      { id: "b5:p2", tab: "b5:t1", agent: "codex", status: "blocked", label: "Investigate the websocket reconnect storm after the laptop wakes from sleep" },
    ] },
  { id: "b6", label: "notes", cwd: "~/notes",
    tabs: [["b6:t1", "todo"]],
    panes: [{ id: "b6:p1", tab: "b6:t1", agent: "", status: "idle", label: "", title: "nvim TODO.md" }] },
];

/** Pane ids the busy scenes pin, so the pinned section has content. */
export const BUSY_PINNED = ["b1:p1", "b3:p1"];

type Rect = [x: number, y: number, width: number, height: number];

/** Tabs with more than one pane; the rest fill their area with one pane. */
const LAYOUTS: Record<string, Array<[string, Rect]>> = {
  "b1:t1": [["b1:p1", [0, 0, 55, 40]], ["b1:p2", [55, 0, 45, 22]], ["b1:p3", [55, 22, 45, 18]]],
  "b1:t2": [["b1:p4", [0, 0, 50, 40]], ["b1:p5", [50, 0, 50, 40]]],
  "b2:t1": [["b2:p1", [0, 0, 50, 20]], ["b2:p2", [50, 0, 50, 20]], ["b2:p3", [0, 20, 50, 20]], ["b2:p4", [50, 20, 50, 20]]],
  "b3:t1": [["b3:p1", [0, 0, 60, 40]], ["b3:p2", [60, 0, 40, 40]]],
  "b4:t1": [["b4:p1", [0, 0, 100, 24]], ["b4:p2", [0, 24, 100, 16]]],
  "b5:t1": [["b5:p1", [0, 0, 50, 40]], ["b5:p2", [50, 0, 50, 40]]],
};

export function busySnapshot(): SnapshotWire {
  const panes = SPACES.flatMap((space) => space.panes.map((pane, index) => ({
    pane_id: pane.id,
    workspace_id: space.id,
    tab_id: pane.tab,
    cwd: pane.cwd ?? space.cwd,
    agent: pane.agent,
    ...(pane.agent ? { agent_status: pane.status } : {}),
    label: pane.label || null,
    terminal_title: pane.title ?? null,
    history_available: !!pane.agent,
    terminal_id: `terminal-${pane.id}`,
    agent_instance_id: pane.agent ? `agent-${pane.id}` : undefined,
    revision: 10 + index,
    state_change_seq: 20 + index,
    interactive_ready: pane.status !== "unknown",
  })));
  const tabs = SPACES.flatMap((space) => space.tabs.map(([tab_id, label]) => ({ tab_id, workspace_id: space.id, label })));
  const layouts = tabs.map((tab) => {
    const rects = LAYOUTS[tab.tab_id]
      ?? panes.filter((pane) => pane.tab_id === tab.tab_id).map((pane): [string, Rect] => [pane.pane_id, [0, 0, 100, 40]]);
    return {
      workspace_id: tab.workspace_id, tab_id: tab.tab_id, zoomed: false, focused_pane_id: rects[0]?.[0],
      area: { x: 0, y: 0, width: 100, height: 40 },
      panes: rects.map(([pane_id, [x, y, width, height]], index) => ({ pane_id, focused: index === 0, rect: { x, y, width, height } })),
    };
  });
  return {
    focused: { workspace_id: "b1", tab_id: "b1:t1", pane_id: "b1:p1" },
    workspaces: SPACES.map((space) => ({ workspace_id: space.id, label: space.label, cwd: space.cwd })),
    tabs,
    panes,
    layouts,
  };
}

const C = { dim: "\u001b[2m", green: "\u001b[32m", yellow: "\u001b[33m", blue: "\u001b[34m", cyan: "\u001b[36m", red: "\u001b[31m", bold: "\u001b[1m", off: "\u001b[0m" };

const SHELL_TEXT: Record<string, string[]> = {
  "b1:p3": [`${C.green}VITE v6.3.5${C.off}  ready in ${C.bold}412 ms${C.off}`, "", `  ➜  Local:   ${C.cyan}http://localhost:5173/${C.off}`, `  ➜  Network: ${C.cyan}http://192.168.1.20:5173/${C.off}`, "", `${C.dim}10:42:07${C.off} ${C.green}[vite]${C.off} hmr update /src/features/operations/create-sheet.tsx`, `${C.dim}10:42:31${C.off} ${C.green}[vite]${C.off} hmr update /src/features/operations/styles/create-sheet.scss`],
  "b1:p6": ["$ git log --oneline -5", `${C.yellow}3fe2517${C.off} Refine PWA grouping and create controls`, `${C.yellow}7850c20${C.off} Sync deployed PWA`, `${C.yellow}05c70b8${C.off} Scope verification by change type`, "", "$ ./scripts/release.sh v2.5.0", `${C.dim}building darwin/arm64 …${C.off}`, "❯ "],
  "b2:p4": [`${C.bold}next dev${C.off} --host`, `  ▲ Next.js 15.2`, `  - Local: ${C.cyan}http://localhost:3000${C.off}`, "", ` ${C.green}✓${C.off} Compiled /dashboard in 1.8s (1203 modules)`, ` ${C.yellow}⚠${C.off} Fast Refresh had to perform a full reload`, ` ${C.green}✓${C.off} Compiled in 240ms`],
  "b3:p2": [`${C.dim}2026-09-24T10:41:58Z${C.off} INFO  request_id=8f2c GET /v2/ws 101`, `${C.dim}2026-09-24T10:41:59Z${C.off} INFO  request_id=8f2d GET /health 200 2ms`, `${C.dim}2026-09-24T10:42:03Z${C.off} ${C.yellow}WARN${C.off}  upstream slow: edge-cache p95=820ms`, `${C.dim}2026-09-24T10:42:05Z${C.off} INFO  request_id=8f31 POST /v2/pair 200 38ms`, `${C.dim}2026-09-24T10:42:09Z${C.off} ${C.red}ERROR${C.off} redis: connection reset by peer (retrying)`],
  "b6:p1": [`${C.bold}# TODO${C.off}`, "", "- [x] Sticky workspace headers", "- [x] Real agent icons", "- [ ] Board: pinch to zoom on iPad", "- [ ] Settings: export diagnostics", "", `${C.dim}~${C.off}`, `${C.dim}~${C.off}`, `${C.dim}"TODO.md" 8L, 164B${C.off}`],
};

const AGENT_LINE: Record<string, string> = {
  working: `${C.blue}●${C.off} Working… ${C.dim}(esc to interrupt)${C.off}`,
  blocked: `${C.yellow}?${C.off} Allow running ${C.bold}bun test src/features${C.off}? ${C.dim}[y/n]${C.off}`,
  done: `${C.green}✓${C.off} Done. All checks passed.`,
  idle: "❯ ",
  unknown: `${C.dim}…${C.off}`,
};

/** A short, pane-specific screen for board previews and the pane reader. */
export function busyPaneText(paneId: string): string | undefined {
  if (SHELL_TEXT[paneId]) return SHELL_TEXT[paneId].join("\n");
  const pane = SPACES.flatMap((space) => space.panes.map((item) => ({ ...item, space }))).find((item) => item.id === paneId);
  if (!pane) return undefined;
  return [
    `${C.bold}${C.cyan}${pane.agent}${C.off}  ·  ${pane.space.cwd}`,
    "",
    `${C.dim}>${C.off} ${pane.label}`,
    "",
    `${C.green}✓${C.off} Read 6 files`,
    `${C.green}✓${C.off} Edited src/${pane.space.label}/index.ts ${C.green}+18${C.off} ${C.red}-5${C.off}`,
    pane.status === "done" ? `${C.green}✓${C.off} Tests: 42 passed` : `${C.dim}  running tests…${C.off}`,
    "",
    AGENT_LINE[pane.status],
  ].join("\n");
}
