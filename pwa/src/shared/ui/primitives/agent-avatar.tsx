import { SquareTerminal } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { agentIcon } from "./agent-icons";

export type AvatarStatus = "blocked" | "working" | "done" | "idle" | "unknown";

function monogram(kind: string): string {
  const letters = kind.replace(/[^a-z0-9]/gi, "");
  return (letters.slice(0, 1).toUpperCase() + letters.slice(1, 2).toLowerCase()) || "?";
}

function hue(kind: string): number {
  let hash = 0;
  for (const char of kind) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * The square that identifies what runs in a pane: the agent's own mark, a
 * monogram for a kind without one, or a terminal glyph for a plain shell. The
 * optional corner dot reports the agent status and is decorative; the owning
 * row states the status in text.
 */
export function AgentAvatar({ kind, status, size = "md", className = "" }: {
  kind: string;
  status?: AvatarStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const trimmed = kind.trim();
  const icon = agentIcon(trimmed);
  let content: ReactNode;
  let style: CSSProperties | undefined;
  let variant: string;
  if (!trimmed) {
    content = <SquareTerminal aria-hidden="true" />;
    variant = "is-terminal";
  } else if (icon) {
    content = <svg viewBox="0 0 24 24" fillRule="evenodd" fill="currentColor" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon.body }} />;
    style = icon.tint ? { color: icon.tint } : undefined;
    variant = icon.mono ? "is-mark" : "is-mark is-color";
  } else {
    content = monogram(trimmed);
    const h = hue(trimmed.toLowerCase());
    style = { background: `hsl(${h} 22% 16%)`, color: `hsl(${h} 62% 76%)` };
    variant = "is-monogram";
  }
  return (
    <span className={`agent-avatar ${variant} is-${size}${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      {content}
      {status ? <span className={`agent-avatar-status is-${status}`} /> : null}
    </span>
  );
}
