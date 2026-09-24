import { locale, t, type CopyKey } from "../../lib/i18n";
import { quotaIsStale, type AgentQuota, type QuotaRead, type QuotaStatus, type QuotaWindow } from "../../lib/agent-quota";
import { formatDeviceAge } from "../../lib/ui-model";

/**
 * Pure projection from quota protocol data to what the quota surfaces paint.
 *
 * No application state, no paint loop and no DOM: every function here takes the
 * data it needs and returns copy plus structure, so the connected page decides
 * only *which* session and snapshot to project.
 */

export type QuotaProvider = AgentQuota["provider"];

export const providerNames: Record<QuotaProvider, string> = {
  codex: "Codex", claude: "Claude Code", antigravity: "Antigravity",
  copilot: "GitHub Copilot", cursor: "Cursor", grok: "Grok Build",
};

/** Short names for the settings module rows. */
export const shortProviderNames: Record<QuotaProvider, string> = {
  codex: "Codex", claude: "Claude", antigravity: "Antigravity",
  copilot: "Copilot", cursor: "Cursor", grok: "Grok",
};

const providerHelpKeys = {
  codex: "quota.codexHelp",
  claude: "quota.claudeHelp",
  antigravity: "quota.antigravityHelp",
  copilot: "quota.copilotHelp",
  cursor: "quota.cursorHelp",
  grok: "quota.grokHelp",
} as const;

const WINDOW_NAMES: Record<string, CopyKey> = {
  "premium interactions": "quota.window.premium",
  chat: "quota.window.chat",
  completions: "quota.window.completions",
  "Shared subscription quota": "quota.window.shared",
  "Included plan": "quota.window.included",
  "five hour": "quota.window.fiveHour",
  five_hour: "quota.window.fiveHour",
  "seven day": "quota.window.sevenDay",
  seven_day: "quota.window.sevenDay",
  "seven day sonnet": "quota.window.sevenDaySonnet",
  "seven day opus": "quota.window.sevenDayOpus",
  "seven day cowork": "quota.window.sevenDayCowork",
  "seven day routines": "quota.window.sevenDayRoutines",
  spend_limit: "quota.window.spend",
  "spend limit": "quota.window.spend",
};

const statusKeys = {
  ok: "quota.ok",
  stale: "quota.stale",
  not_installed: "quota.notInstalled",
  not_logged_in: "quota.notLoggedIn",
  unsupported: "quota.unsupported",
  unavailable: "quota.unavailable",
  setup_required: "quota.setupRequired",
  auth_required: "quota.authRequired",
  not_running: "quota.notRunning",
} as const satisfies Record<QuotaStatus, string>;

/** Statuses whose provider needs a setup hint rather than a number. */
const HELP_STATUSES: QuotaStatus[] = ["auth_required", "not_installed", "not_running", "not_logged_in"];

export function quotaWindowName(name: string): string {
  const key = WINDOW_NAMES[name] ?? WINDOW_NAMES[name.replaceAll("_", " ")];
  return key ? t(key) : name;
}

/** Copilot's overview reads only premium interactions; its other windows are separate categories. */
function overviewWindows(q: QuotaRead): readonly QuotaWindow[] {
  return q.provider === "copilot" ? q.windows.filter(w => w.name === "premium interactions") : q.windows;
}

/**
 * The window the overview shows for one provider: the one with the least
 * remaining, or the unlimited one when nothing is limited. Null when the read
 * is missing, not ok or stale.
 */
export function quotaTightestWindow(q: QuotaRead | undefined): QuotaWindow | null {
  if (!q || q.status !== "ok" || quotaIsStale(q)) return null;
  const windows = overviewWindows(q);
  const limited = windows.filter(w => !w.unlimited);
  if (!limited.length) return windows[0] ?? null;
  return limited.reduce((tightest, w) => w.used_percent > tightest.used_percent ? w : tightest);
}

/** One compact allowance number for a provider, or null when unknown. */
export function quotaOverview(q: QuotaRead | undefined): number | "unlimited" | null {
  const w = quotaTightestWindow(q);
  if (!w) return null;
  return w.unlimited ? "unlimited" : 100 - w.used_percent;
}

export type QuotaTone = "ok" | "warn" | "error";

/** Below 30% the meter turns yellow, below 10% red. */
export function quotaTone(remaining: number): QuotaTone {
  return remaining < 10 ? "error" : remaining < 30 ? "warn" : "ok";
}

/** When a window comes back, relative to now: "2 小时后重置". */
export function quotaResetIn(resetsAt: number, now = Date.now() / 1000): string {
  if (!resetsAt) return t("quota.resetUnknown");
  const seconds = resetsAt - now;
  if (seconds < 60) return t("quota.resetSoon");
  if (seconds < 3_600) return t("quota.resetIn.minutes", { n: Math.floor(seconds / 60) });
  if (seconds < 86_400) return t("quota.resetIn.hours", { n: Math.floor(seconds / 3_600) });
  return t("quota.resetIn.days", { n: Math.floor(seconds / 86_400) });
}

/** The reset point itself: a clock time within a day, a short date after that. */
export function quotaResetAt(resetsAt: number, now = Date.now() / 1000): string {
  const at = new Date(resetsAt * 1000);
  return resetsAt - now < 86_400
    ? new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(at)
    : new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric" }).format(at);
}

/** What a meter paints: a limited remaining share, or unlimited. */
export type QuotaMeterModel = { kind: "limited"; remaining: number; tone: QuotaTone; aria: string } | { kind: "unlimited"; aria: string };

function meterOf(name: string, window: string, w: QuotaWindow): QuotaMeterModel {
  if (w.unlimited) return { kind: "unlimited", aria: `${name} ${window}: ${t("quota.unlimited")}` };
  const remaining = Math.round(100 - w.used_percent);
  return { kind: "limited", remaining, tone: quotaTone(remaining), aria: t("quota.meterAria", { name, window, percent: remaining }) };
}

/** One window row on the quota page: its span, when it resets, and its meter. */
export type QuotaWindowModel = { key: string; label: string; sub: string; meter: QuotaMeterModel };

export type QuotaCardModel = {
  provider: QuotaProvider;
  title: string;
  plan: string;
  /** Fresh windows to draw, stale data to flag, or no data (the missing group). */
  state: "fresh" | "stale" | "missing";
  statusCopy: string;
  /** "1 分钟前更新", or null when the provider never reported. */
  updated: string | null;
  /** Windows are drawn only for a fresh `ok` snapshot. */
  windows: QuotaWindowModel[];
  help: string | null;
  /** An extra CLI/current-command hint only some statuses carry (Cursor auth). */
  helpDetail: string | null;
  /** The Cursor auth command, shown after the help and never on other states. */
  helpCommand: string | null;
  /** Provider and source notes, in the order the card has always shown them. */
  notes: string[];
  /** Setup command kept in its original ending placement (Claude setup_required). */
  command: string | null;
};

/** A window's span as a short label ("5 小时", "7 天"), or its name when the daemon sent no span. */
function windowLabel(w: QuotaWindow): string {
  return w.window_minutes && w.window_minutes % 1440 === 0
    ? t("quota.span.days", { count: w.window_minutes / 1440 })
    : w.window_minutes && w.window_minutes % 60 === 0
      ? t("quota.span.hours", { count: w.window_minutes / 60 })
      : w.window_minutes
        ? t("quota.span.minutes", { count: w.window_minutes })
        : quotaWindowName(w.name);
}

export function quotaCardModel(q: QuotaRead): QuotaCardModel {
  const title = providerNames[q.provider];
  const stale = (q.status === "ok" || q.status === "stale") && quotaIsStale(q);
  const status = stale ? "stale" : q.status;
  const windows: QuotaWindowModel[] = status === "ok" ? q.windows.map((w, index) => {
    const label = windowLabel(w);
    return {
      key: `${w.name}:${index}`,
      label: w.unlimited ? quotaWindowName(w.name) : label,
      sub: w.unlimited ? t("quota.unlimited") : w.resets_at ? `${quotaResetIn(w.resets_at)} · ${quotaResetAt(w.resets_at)}` : t("quota.resetUnknown"),
      meter: meterOf(title, label, w),
    };
  }) : [];
  const notes: string[] = [];
  if (q.provider === "copilot") notes.push(t("quota.copilotNote"));
  if (q.provider === "grok") notes.push(t("quota.grokNote"));
  if (q.source === "statusline") notes.push(t("quota.claudeNote"));
  // Help selection is per provider/status. Cursor unsupported gets its own
  // guidance, and only auth_required also carries the keychain hint plus the
  // exact three-line CLI command; other providers' statuses keep their setup
  // hint and no command (setup_required keeps the Claude command below).
  const help = q.provider === "cursor" && q.status === "unsupported"
    ? t("quota.cursorUnsupportedHelp")
    : HELP_STATUSES.includes(q.status)
      ? t(providerHelpKeys[q.provider])
      : null;
  const helpDetail = q.provider === "cursor" && q.status === "auth_required" ? t("quota.cursorKeychainHelp") : null;
  // The Cursor auth command is its own slot after the help; the original
  // Claude setup command keeps its ending placement in `command`.
  const helpCommand = q.provider === "cursor" && q.status === "auth_required"
    ? "export AGENT_CLI_CREDENTIAL_STORE=file\ncursor-agent login\npairfob service install"
    : null;
  return {
    provider: q.provider,
    title,
    plan: q.plan || t("quota.planUnknown"),
    state: status === "ok" ? "fresh" : status === "stale" ? "stale" : "missing",
    statusCopy: t(statusKeys[status]),
    updated: q.observed_at ? t("quota.updatedAgo", { when: formatDeviceAge(q.observed_at) }) : null,
    windows,
    help,
    helpDetail,
    helpCommand,
    notes,
    command: q.status === "setup_required" ? "pairfob quota-setup-claude" : null,
  };
}

/** The slice of a published snapshot the panel and summary projections read. */
export type QuotaSnapshotLike = {
  readonly loading: boolean;
  readonly items: readonly QuotaRead[] | null;
  readonly error: string;
};

export type QuotaPanelModel = {
  busy: boolean;
  error: string | null;
  offline: boolean;
  offlineCopy: string;
  cards: QuotaCardModel[];
};

/** A provider with a fresh snapshot sorts ahead of one that is stale or missing. */
function hasFreshData(q: QuotaRead): boolean {
  return q.status === "ok" && !quotaIsStale(q);
}

export function quotaPanelModel(snapshot: QuotaSnapshotLike | undefined, connected: boolean): QuotaPanelModel {
  return {
    busy: !!snapshot?.loading,
    error: snapshot?.error === "quota.upgrade" || snapshot?.error === "quota.failed"
      ? t(snapshot.error) : snapshot?.error || null,
    offline: !connected,
    offlineCopy: t("quota.offline"),
    cards: [...(snapshot?.items ?? [])].sort((a, b) => Number(hasFreshData(b)) - Number(hasFreshData(a)))
      .map(quotaCardModel),
  };
}

/** One provider row in the settings quota module. */
export type QuotaModuleRow = { provider: QuotaProvider; name: string; sub: string; meter: QuotaMeterModel };

export type QuotaModuleModel = {
  /** Offline and failed reads show one line instead of empty meters. */
  state: "offline" | "loading" | "error" | "ready";
  rows: QuotaModuleRow[];
  /** Providers the module does not draw: stale, missing, or not reported. */
  noData: number;
  updated: string | null;
};

/**
 * The settings quota module: one row per provider with a fresh read, in the
 * fixed provider order (never re-sorted by how much is left), each showing its
 * tightest window and when that window resets.
 */
export function quotaModuleModel(snapshot: QuotaSnapshotLike | undefined, connected: boolean): QuotaModuleModel {
  const providers = Object.keys(providerNames) as QuotaProvider[];
  if (!connected) return { state: "offline", rows: [], noData: 0, updated: null };
  if (snapshot?.error) return { state: "error", rows: [], noData: 0, updated: null };
  if (!snapshot?.items) return { state: snapshot?.loading ? "loading" : "error", rows: [], noData: 0, updated: null };
  const rows: QuotaModuleRow[] = [];
  let newest = 0;
  for (const provider of providers) {
    const q = snapshot.items.find(item => item.provider === provider);
    const w = quotaTightestWindow(q);
    if (!q || !w) continue;
    newest = Math.max(newest, q.observed_at);
    const name = shortProviderNames[provider];
    const label = w.unlimited ? quotaWindowName(w.name) : windowLabel(w);
    rows.push({
      provider, name,
      sub: w.unlimited ? `${label} · ${t("quota.unlimited")}` : `${label} · ${w.resets_at ? quotaResetIn(w.resets_at) : t("quota.resetUnknown")}`,
      meter: meterOf(name, label, w),
    });
  }
  return {
    state: "ready",
    rows,
    noData: providers.length - rows.length,
    updated: newest ? t("quota.updatedAgo", { when: formatDeviceAge(newest) }) : null,
  };
}
