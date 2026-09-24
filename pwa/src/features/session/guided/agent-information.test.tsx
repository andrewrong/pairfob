import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { resetBoardTestDOM } from "../../../../test-support/dom";
import { renderReact, unmountReact } from "../../../../test-support/react-harness";
import { WorkspaceSnapshotRestorer } from "../../../../test-support/workspace-snapshot-restore";
import { appRoot } from "../../../app/dom-root";
import { setLang } from "../../../lib/i18n";
import type { LiveSession } from "../../../lib/protocol/client";
import type { AgentInspection } from "../../../lib/agent-inspect";
import { NO_OPERATION_CAPABILITIES } from "../../../lib/operations";
import { applyCapabilities } from "../../operations/capabilities-store";
import { attachLiveSession } from "../../computers/catalog-store";
import { applySnapshot, selectedAgent } from "../../dashboard/catalog-store";
import { selectPane } from "../session-store";
import { AgentInformation } from "./agent-information";

const restorer = new WorkspaceSnapshotRestorer();
let session: LiveSession;
const snapshot = (instance = "first") => ({ workspaces: [{ workspace_id: "w", tokens: { branch: "feature" } }], panes: [{
  pane_id: "info-pane", workspace_id: "w", agent: "codex", agent_status: "idle", agent_instance_id: instance,
  display_agent: "Reviewer", tokens: { task: "<script>not executable</script>" },
}] });
beforeEach(async () => {
  await resetBoardTestDOM(); unmountReact(); restorer.capture();
  session = { agentInspect: async () => ({ status: "idle", manifest_version: "1.2", rules: [], screen_detection_skipped: false }) } as unknown as LiveSession;
  act(() => { setLang("zh"); attachLiveSession(session); selectPane("info-pane"); applySnapshot(snapshot());
    applyCapabilities({ ...NO_OPERATION_CAPABILITIES, agent_inspect: true }, ["codex"]); });
});
afterEach(() => { unmountReact(); act(() => { restorer.restore(); attachLiveSession(null); selectPane(""); }); });
test("information is text-only and diagnosis loads only after an explicit click", async () => {
  let reads = 0;
  session.agentInspect = async () => { reads++; return { status: "idle", manifest_version: "1.2", rules: [], screen_detection_skipped: false }; };
  renderReact(<AgentInformation agent={selectedAgent()!} session={session} />);
  expect(reads).toBe(0); expect(appRoot().textContent).toContain("Reviewer");
  expect(appRoot().querySelector("script")).toBeNull();
  await act(async () => { (appRoot().querySelector(".pane-inspect") as HTMLButtonElement).click(); });
  expect(reads).toBe(1); expect(appRoot().textContent).toContain("1.2");
});
test("missing capability hides inspection and a replaced agent hides delayed replies", async () => {
  act(() => applyCapabilities(NO_OPERATION_CAPABILITIES, []));
  renderReact(<AgentInformation agent={selectedAgent()!} session={session} />);
  expect(appRoot().querySelector(".pane-inspect")).toBeNull();
  act(() => applyCapabilities({ ...NO_OPERATION_CAPABILITIES, agent_inspect: true }, []));
  let resolve!: (value: AgentInspection) => void;
  session.agentInspect = () => new Promise(done => { resolve = done; });
  act(() => (appRoot().querySelector(".pane-inspect") as HTMLButtonElement).click());
  act(() => applySnapshot(snapshot("replacement")));
  await act(async () => resolve({ status: "idle", manifest_version: "stale-version", rules: [], screen_detection_skipped: false }));
  expect(appRoot().textContent).toContain("Agent 已更换"); expect(appRoot().textContent).not.toContain("stale-version");
});
