export type SlashCommand = {
  token: string;
  label: string;
  ariaKey?: "slash.goal" | "slash.loop";
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { token: "/clear", label: "/clear" },
  { token: "/new", label: "/new" },
  { token: "/compact", label: "/compact" },
  { token: "/model", label: "/model" },
  { token: "/goal ", label: "/goal", ariaKey: "slash.goal" },
  { token: "/loop ", label: "/loop", ariaKey: "slash.loop" },
  { token: "/usage", label: "/usage" },
  { token: "/help", label: "/help" },
];

// Official catalogs: https://code.claude.com/docs/en/commands
// https://developers.openai.com/codex/cli/slash-commands
function tokens(values: string[]): SlashCommand[] {
  return values.map(token => ({ token, label: token.trim() }));
}

/** Agent identity comes from the live dashboard snapshot, never from a guessed title. */
export function slashCommandsForAgent(agent: string): SlashCommand[] {
  switch (agent.trim().toLowerCase()) {
    case "claude":
    case "claude-code":
      return [...SLASH_COMMANDS, ...tokens(["/resume", "/context", "/diff", "/review"])];
    case "codex":
      return tokens(["/new", "/compact", "/model", "/status", "/goal ", "/diff", "/review", "/resume",
        "/fork", "/mention ", "/plan", "/skills"]);
    default:
      return [];
  }
}
