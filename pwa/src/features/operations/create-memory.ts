/**
 * What the create sheet remembers on this phone: which agent kinds the reader
 * pinned, how often and how recently each was started, the last few
 * "kind in workspace" combinations and the directories new workspaces were
 * created in.
 *
 * Device-local conveniences only. None of it is authority: the kinds offered
 * are always the ones the computer advertises, and a remembered directory is
 * still checked by the daemon like any other path.
 */
import { OPERATION_INPUT_LIMITS } from "../../lib/operations";
import { LAST_AGENT_KIND_KEY } from "./operation-form-model";

export const CREATE_MEMORY_KEY = "pairfob:createMemory";

const MAX_RECENTS = 3;
const MAX_DIRS = 5;

export type CreateCombo = { kind: string; workspaceId: string };

export type CreateMemory = {
  pinned: string[];
  uses: Record<string, number>;
  lastUsed: Record<string, number>;
  recents: CreateCombo[];
  dirs: string[];
};

const EMPTY: CreateMemory = { pinned: [], uses: {}, lastUsed: {}, recents: [], dirs: [] };

function kindOk(value: unknown): value is string {
  return typeof value === "string" && value.length <= OPERATION_INPUT_LIMITS.agentKind;
}

function numbers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, stamp] of Object.entries(value)) {
    if (kindOk(key) && typeof stamp === "number" && Number.isFinite(stamp) && stamp > 0) out[key] = stamp;
  }
  return out;
}

/** Parse stored memory, dropping anything malformed instead of failing. */
export function parseCreateMemory(raw: string | null): CreateMemory {
  let value: unknown;
  try {
    value = JSON.parse(raw || "null");
  } catch {
    return { ...EMPTY };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY };
  const record = value as Record<string, unknown>;
  const pinned = Array.isArray(record.pinned) ? record.pinned.filter((kind): kind is string => kindOk(kind) && kind !== "") : [];
  const recents = Array.isArray(record.recents)
    ? record.recents.flatMap((item): CreateCombo[] => {
        if (!item || typeof item !== "object") return [];
        const { kind, workspaceId } = item as Record<string, unknown>;
        return kindOk(kind) && typeof workspaceId === "string" && workspaceId ? [{ kind, workspaceId }] : [];
      }).slice(0, MAX_RECENTS)
    : [];
  const dirs = Array.isArray(record.dirs)
    ? record.dirs.filter((dir): dir is string => typeof dir === "string" && dir !== "" && dir.length <= OPERATION_INPUT_LIMITS.cwd).slice(0, MAX_DIRS)
    : [];
  return { pinned: [...new Set(pinned)], uses: numbers(record.uses), lastUsed: numbers(record.lastUsed), recents, dirs };
}

export function loadCreateMemory(): CreateMemory {
  try {
    return parseCreateMemory(localStorage.getItem(CREATE_MEMORY_KEY));
  } catch {
    return { ...EMPTY };
  }
}

function save(memory: CreateMemory): void {
  try {
    localStorage.setItem(CREATE_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    /* storage blocked; the next sheet just starts from defaults */
  }
}

export function togglePinnedKind(kind: string): CreateMemory {
  const memory = loadCreateMemory();
  const pinned = memory.pinned.includes(kind) ? memory.pinned.filter((item) => item !== kind) : [...memory.pinned, kind];
  const next = { ...memory, pinned };
  save(next);
  return next;
}

/** Record a create the reader confirmed. `kind` is "" for a plain terminal. */
export function rememberCreate(input: { kind: string; workspaceId?: string; cwd?: string }, at = Date.now()): void {
  const memory = loadCreateMemory();
  const next: CreateMemory = { ...memory };
  if (input.kind) {
    next.uses = { ...memory.uses, [input.kind]: (memory.uses[input.kind] ?? 0) + 1 };
    next.lastUsed = { ...memory.lastUsed, [input.kind]: at };
  }
  if (input.workspaceId) {
    next.recents = [{ kind: input.kind, workspaceId: input.workspaceId },
      ...memory.recents.filter((item) => item.kind !== input.kind || item.workspaceId !== input.workspaceId)].slice(0, MAX_RECENTS);
  }
  if (input.cwd) next.dirs = [input.cwd, ...memory.dirs.filter((dir) => dir !== input.cwd)].slice(0, MAX_DIRS);
  save(next);
  try {
    localStorage.setItem(LAST_AGENT_KIND_KEY, input.kind.slice(0, OPERATION_INPUT_LIMITS.agentKind));
  } catch {
    /* storage blocked */
  }
}

/**
 * The four kinds the grid shows: pinned first, then by use, restricted to what
 * the computer advertises. A kind picked from the full list takes the last slot.
 */
export function favoriteKinds(advertised: readonly string[], memory: CreateMemory, selected = ""): string[] {
  const order = [...advertised].sort((left, right) =>
    Number(memory.pinned.includes(right)) - Number(memory.pinned.includes(left))
    || (memory.uses[right] ?? 0) - (memory.uses[left] ?? 0)
    || advertised.indexOf(left) - advertised.indexOf(right));
  let top = order.slice(0, 4);
  if (selected && advertised.includes(selected) && !top.includes(selected)) top = [...top.slice(0, 3), selected];
  return top;
}
