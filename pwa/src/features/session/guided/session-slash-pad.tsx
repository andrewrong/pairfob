import { currentViewIncarnation } from "../drafts/compose-drafts";
import { useDashboard } from "../../dashboard/hooks";
import { useSession } from "../hooks";
import { usePreferences } from "../../settings/hooks";
import { defaultQuickCommands, editQuickCommands } from "../keypad/quick-command-editor";
import { composeLive } from "../compose-store";
import { openPaneId } from "../session-store";
import { liveSession } from "../../computers/catalog-store";
import { ArrowLeftRight } from "lucide-react";
import type { ReactNode } from "react";
import { PadPages } from "../keypad/pad-pages";
import { slashCommandsForAgent } from "../../../lib/slash-commands";
import { t } from "../../../lib/i18n";
import { padKind } from "../../settings/preferences-store";
import { selectPadKind } from "./slash-pad";
import { setComposeText, setComposeLive } from "./compose";
import { PadChromeButton } from "../compose-focus";

export function SessionPadModeBar({ onRepaint }: { onRepaint: () => void }) {
  const commands = padKind() === "slash";
  return <PadChromeButton
    className="key pad-mode" type="button"
    aria-label={t(commands ? "slash.switchKeys" : "slash.switchCommands")}
    onClick={() => selectPadKind(commands ? "keys" : "slash", onRepaint)}
  >{commands ? t("slash.commandsShort") : t("slash.keys")}<ArrowLeftRight size={14} aria-hidden="true" /></PadChromeButton>;
}

async function fillGuidedDraft(text: string): Promise<void> {
  const pane = openPaneId();
  const session = liveSession();
  const incarnation = currentViewIncarnation();
  await setComposeLive(false);
  if (openPaneId() === pane && liveSession() === session
    && currentViewIncarnation() === incarnation && !composeLive()) setComposeText(text);
}

export function SessionSlashPad({ onSelect = setComposeText, onCustomSelect = fillGuidedDraft, keyItems }: {
  onSelect?: (text: string) => void; onCustomSelect?: (text: string) => void; keyItems?: ReactNode[];
}) {
  const { paneId } = useSession();
  const agent = useDashboard().agents.find(item => item.paneId === paneId)?.agent ?? "";
  const quickCommands = usePreferences().quickCommands ?? defaultQuickCommands();
  const customButton = (command: typeof quickCommands[number]) => <PadChromeButton
    key={`custom:${command.id}`} type="button" className="key quick-cmd"
    title={command.text} aria-label={t("quick.insert", { label: command.label })}
    onClick={() => onCustomSelect(command.text)}>{command.label}</PadChromeButton>;
  const commands = !keyItems || padKind() === "slash";
  const items = commands ? [
    ...quickCommands.filter(command => command.pinned).map(customButton),
    ...slashCommandsForAgent(agent).map((command) => (
    <PadChromeButton
      key={command.token} type="button" className="key slash-cmd"
      aria-label={command.ariaKey ? t(command.ariaKey) : t("slash.insert", { label: command.label })}
      onClick={() => onSelect(command.token)}
    >{command.label}</PadChromeButton>
  )),
    ...quickCommands.filter(command => !command.pinned).map(customButton),
  ] : keyItems;
  return <PadPages items={items} columns={commands ? 4 : 7} kind={commands ? `slash:${agent}` : "keys"}
    label={t(commands ? "slash.agentCmds" : "keys.more")}
    className={commands ? "slash-pad" : ""}
    footer={commands && <PadChromeButton type="button" className="pad-manage"
      onClick={() => editQuickCommands(quickCommands)}>{t("quick.manage")}</PadChromeButton>} />;
}
