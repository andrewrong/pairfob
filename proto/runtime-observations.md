# Optional snapshot runtime observations

`Snapshot` pane objects may include the following additive fields. Older daemons
and runtimes omit them; absence means unknown and must not be interpreted as
`false` or zero.

- `terminal_id`: the live Herdr terminal identity.
- `agent_instance_id`: a lowercase SHA-256 value computed by Pairfob from the
  terminal identity and, when available, the trusted native AgentSession
  identity. Native session IDs and paths are never serialized.
- `revision`: a nonnegative JavaScript-safe terminal revision.
- `state_change_seq`: a nonnegative JavaScript-safe agent state sequence.
- `interactive_ready`: whether the agent can currently accept interaction.
- `launch_pending`: whether agent launch is still pending.

Pairfob joins Herdr's `snapshot.agents` observations to a pane only when both
`pane_id` and `terminal_id` match. Runtime events are local refresh hints; they
are not transported through Pairfob. Snapshots remain authoritative after
subscription setup, reconnect, overflow, or unsupported subscriptions.
