import { ChevronDown } from "lucide-react";
import { t } from "../../../lib/i18n";
import { Button, StatusDot } from "../../../shared/ui/primitives";
import type { HerdHostView } from "../model/herd-view";

/**
 * The phone header title: the computer this list belongs to, and one line for
 * how it is reached. It opens the computer panel (switch, retry, details).
 */
export function HostTitle({ host, onOpen }: { host: HerdHostView; onOpen: () => void }) {
  return (
    <Button
      className={`host-title is-${host.tone}`}
      aria-haspopup="dialog"
      aria-label={t("host.aria", { host: host.name, status: host.line })}
      onClick={onOpen}
    >
      <StatusDot tone={host.tone} />
      <span className="host-title-text">
        <span className="host-title-name">{host.name}<ChevronDown size={16} aria-hidden="true" /></span>
        <span className="host-title-line">{host.line}</span>
      </span>
    </Button>
  );
}
