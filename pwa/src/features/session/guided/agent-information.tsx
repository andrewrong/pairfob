import { useSession } from "../hooks";
import { useState } from "react";
import { useComputers } from "../../computers/hooks";
import { useDashboard } from "../../dashboard/hooks";
import { capabilityEnabled } from "../../operations/capabilities-store";
import { useCapabilities } from "../../operations/hooks";
import { t } from "../../../lib/i18n";
import { statusLabel } from "../../../lib/dashboard";
import { agentObservationKey, type AgentInspection } from "../../../lib/agent-inspect";
import type { AgentCard } from "../../../lib/ranking";
import type { LiveSession } from "../../../lib/protocol/session-types";
import { Button } from "../../../shared/ui/primitives";

function Tokens({ title, values }: { title: string; values?: Readonly<Record<string, string>> }) {
  if (!values || !Object.keys(values).length) return null;
  return <><h3>{title}</h3><dl>{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></>;
}
export function AgentInformation({ agent, session }: { agent: AgentCard; session: LiveSession }) {
  const [result, setResult] = useState<AgentInspection>();
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [resultOwner, setResultOwner] = useState("");
  const current = useDashboard().agents.find(item => item.paneId === agent.paneId);
  const computer = useComputers();
  const capabilities = useCapabilities();
  const owner = agentObservationKey(agent);
  const paneId = useSession().paneId;
  const stale = paneId !== agent.paneId || computer.live !== session || !current || agentObservationKey(current) !== owner;
  const canInspect = !!agent.agent && capabilities.operationCapabilities.agent_inspect && !!session.agentInspect;
  const value = stale ? undefined : current;
  const inspect = async () => {
    if (stale || !canInspect || !capabilityEnabled("agent_inspect") || state === "loading") return;
    setState("loading"); setResult(undefined);
    try {
      const reply = await session.agentInspect!(agent.paneId);
      setResult(reply); setResultOwner(owner); setState("idle");
    } catch { setState("failed"); }
  };
  return <div className="agent-information" style={{ overflowWrap: "anywhere" }}>
    {stale ? <p role="status">{t("agentInfo.stale")}</p> : <>
      <p className="empty-sub">{t("agentInfo.displayHint")}</p>
      <dl>
        {value?.displayAgent && <><dt>{t("agentInfo.displayName")}</dt><dd>{value.displayAgent}</dd></>}
        {value?.stateLabels?.[value.status] && <><dt>{t("agentInfo.stateLabel")}</dt><dd>{value.stateLabels[value.status]}</dd></>}
        {value?.worktree && <>
          <dt>{t("agentInfo.project")}</dt><dd>{value.worktree.repo_name}{value.worktree.is_linked_worktree ? ` · ${t("agentInfo.worktree")}` : ""}</dd>
          <dt>{t("agentInfo.checkout")}</dt><dd>{value.worktree.checkout_path}</dd>
        </>}
      </dl>
      {!value?.displayAgent && !value?.worktree && !value?.stateLabels && !value?.tokens && !value?.workspaceTokens && <p>{t("agentInfo.empty")}</p>}
      <Tokens title={t("agentInfo.paneTokens")} values={value?.tokens} />
      <Tokens title={t("agentInfo.workspaceTokens")} values={value?.workspaceTokens} />
      {canInspect ? <Button className="btn" disabled={state === "loading"} onClick={() => void inspect()}>{t(state === "loading" ? "agentInfo.loading" : "agentInfo.inspect")}</Button>
        : <p>{t("agentInfo.unsupported")}</p>}
      {state === "failed" && <p role="alert">{t("agentInfo.failed")}</p>}
      {result && resultOwner === owner && <>
        <p className="empty-sub">{t("agentInfo.hint")}</p>
        <p>{statusLabel(result.status)}</p>
        {result.screen_detection_skipped && <p>{t("agentInfo.hooks")}</p>}
        <dl>{([ ["agentInfo.source", result.manifest_source], ["agentInfo.version", result.manifest_version],
          ["agentInfo.rule", result.matched_rule], ["agentInfo.fallback", result.fallback_reason],
          ["agentInfo.skipped", result.skipped_reason] ] as const).map(([key, text]) => text ? <div key={key}><dt>{t(key)}</dt><dd>{text}</dd></div> : null)}</dl>
        {result.warning && <p role="status">{result.warning}</p>}
        {result.rules.length > 0 && <details><summary>{t("agentInfo.rules")}</summary><ul>{result.rules.map((rule, index) =>
          <li key={index}>{rule.id} · {statusLabel(rule.state)} · {t(rule.matched ? "agentInfo.matched" : "agentInfo.unmatched")}</li>)}</ul></details>}
      </>}
    </>}
  </div>;
}
