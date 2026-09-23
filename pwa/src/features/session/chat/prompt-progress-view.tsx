import { useEffect, useState } from "react";
import { useChat, useSession } from "../hooks";
import { useDashboard } from "../../dashboard/hooks";
import { agentFromDashboardSnapshot } from "../agents";
import { t } from "../../../lib/i18n";
import { applyTrace, chatSnapshot } from "./trace-store";
import { observedPromptActivity, promptProgressMessage } from "./prompt-progress";

export function PromptProgressView() {
  const progress = useChat().promptProgress;
  const agent = agentFromDashboardSnapshot(useDashboard(), useSession().paneId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!progress || progress.phase !== "submitted") return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, progress.startedAt + 8000 - Date.now()));
    return () => clearTimeout(timer);
  }, [progress]);
  useEffect(() => {
    if (progress?.phase === "submitted" && agent && observedPromptActivity(progress, agent)
      && chatSnapshot().promptProgress?.startedAt === progress.startedAt) {
      applyTrace({ promptProgress: { ...progress, phase: "processing" } });
    }
  }, [progress, agent]);
  const message = promptProgressMessage(progress, agent, now);
  return message ? <p className="empty-sub" role="status" aria-live="polite" data-prompt-progress="">{t(message)}</p> : null;
}
