# AgentInspect and display metadata

`AgentInspect` is an additive read-only inner RPC on an Established session,
with `params: {pane_id, session?}`. `GetConfig.capabilities.agent_inspect` must
be true before offering inspection; absence means unavailable. The runtime
adapter requires a live Herdr version of at least 0.8.2. A named session is
checked independently when queried. Unknown runtimes fail closed.

The result follows `$defs.agentInspectResult` in `rpc.schema.json`. It contains
runtime detection status, manifest source basename/version, matched rule ID,
fallback/skip reason, warning, and at most 32 rule summaries. Each string is at
most 256 Unicode characters. It never returns screen previews, evaluated regex
content, process arguments, or native agent session references. The runtime's
raw detection status is diagnostic, not proof of task completion. The existing
snapshot/task-evidence pipeline remains authoritative for product status.

Snapshot pane objects can additionally contain `display_agent`, `state_labels`
and `tokens`. Workspace objects can contain `tokens` and `worktree` (repo_name,
checkout_path, is_linked_worktree). These are display-only, optional fields.
Token maps have at most 32 keys, keys match `[A-Za-z0-9_-]{1,32}`, values and
other display strings are at most 256 Unicode characters. State label keys
must be known statuses. Control and formatting characters are stripped.
The checkout path is display-only and cannot authorize a filesystem operation.
Absent metadata preserves existing UI behavior; expired upstream metadata is
removed on the next snapshot. Tokens are arbitrary labels, not usage counters.

PromptAgent's existing `agent_status` field now returns `unknown` after a
successful submission: input acceptance alone does not establish processing.
The chat UI separates sending, accepted input, observed processing, transcript
receipt, and blocked confirmation. After eight seconds without activity it
shows an unconfirmed-start hint; this is not a failed mutation and never
triggers replay. A task already working at submission cannot confirm this new
input by merely finishing. Completion notifications still require task evidence.
