import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../../app/dom-root";
import { setLang, t } from "../../../lib/i18n";
import type { LiveSession } from "../../../lib/protocol/client";
import { setPhase, setNetworkOnline } from "../../connection/connection-store";
import { applyRuntimeIdentity, runtimeIdentity } from "../../connection/runtime-store";
import { attachLiveSession } from "../../computers/catalog-store";
import { applySnapshot, selectedAgent } from "../../dashboard/catalog-store";
import { selectPane } from "../session-store";
import { SessionChrome } from "./session-chrome";
import type { SessionHandlers } from "./view";

const restorer = new WorkspaceSnapshotRestorer();
const noop = () => {};
const handlers: SessionHandlers = { onBack: noop, onMenu: noop, onWorkspace: noop };

beforeEach(async () => {
  await resetBoardTestDOM();
  unmountReact();
  restorer.capture();
  act(() => {
    setLang("zh");
    setPhase("live");
    setNetworkOnline(true);
    applyRuntimeIdentity({ herdHost: runtimeIdentity().herdHost, runtimeKind: "herdr" });
    attachLiveSession({ isConnected: () => true } as unknown as LiveSession);
    selectPane("lifecycle-pane");
  });
});

afterEach(() => {
  unmountReact();
  act(() => {
    restorer.restore();
    attachLiveSession(null);
    selectPane("");
  });
});

test("session chrome separates launch, readiness and actual task states", () => {
  for (const phase of [
    { status: "working", pending: true, ready: false, label: "status.starting", dot: "idle" },
    { status: "done", pending: true, ready: false, label: "status.starting", dot: "idle" },
    { status: "idle", pending: false, ready: true, label: "status.ready", dot: "idle" },
    { status: "working", pending: false, ready: true, label: "status.working", dot: "working" },
    { status: "done", pending: false, ready: true, label: "status.done", dot: "done" },
  ] as const) {
    act(() => applySnapshot({
      workspaces: [{ workspace_id: "w", label: "project", cwd: "/repo/project" }],
      panes: [{ pane_id: "lifecycle-pane", workspace_id: "w", agent: "codex", agent_status: phase.status,
        launch_pending: phase.pending, interactive_ready: phase.ready }],
    }));
    renderReact(<SessionChrome selected={selectedAgent()} includeBack={true} handlers={handlers} />);
    expect(appRoot().querySelector(".chrome-status")?.textContent).toBe(t(phase.label));
    expect(appRoot().querySelector(`.agent-avatar-status.is-${phase.dot}`)).not.toBeNull();
    // Stop is the send button's; the header has none in any phase.
    expect(appRoot().querySelector(".icon-stop")).toBeNull();
  }
});
