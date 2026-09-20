# Workspace upload (attachment)

`WorkspaceUploadBegin`, `WorkspaceUploadWrite`, `WorkspaceUploadStatus`,
`WorkspaceUploadCommit`, and `WorkspaceUploadCancel` are additive inner RPCs on
an Established Pairfob session. They use the existing encrypted FWD transport
and the same frozen mutation vocabulary (`operation_id`, `unknown_outcome`,
`conflict`, …). The origin/relay never sees plaintext bytes and never parses
`FWD`; identity, keys, and origin live only on the daemon as with every other
mutation. No Worker HTTP path and no R2 object is added. An older daemon
returns `unknown_op`; the phone treats only that code as “update the daemon”.

This is an **upload only**. The daemon stores the published bytes in the live
workspace root under a controlled final directory; it does **not** give the
bytes to any model, does not run OCR, and does not make image/video content
available to a pure-text model that cannot see it. Attachments are
agent-independent paths — a human or a capable client reads the committed file
through `WorkspaceRead`. The daemon performs no content interpretation
whatsoever. There is no external OCR integration, now or planned in this
protocol.

## Lifecycle

A single client-side `upload_id` (a UUID) names one upload across its lifetime,
owned by the authenticated device that began it. Phases:

1. `WorkspaceUploadBegin` — reserve quota, write the immutable binding
   (device, `upload_id`, size, sha256, mime, pane, canonical root), and publish
   the in-memory handle. Server may refuse before any byte is staged
   (`rate_limited`, `backpressure`) or reject malformed metadata
   (`invalid_argument`, `too_large`) — validation happens before any staging
   side effect.
2. `WorkspaceUploadWrite` — one bounded base64 chunk at the exact sequential
   offset. Writes advance the acknowledged `offset` only after the bytes are
   durable; any write/hash/sync failure leaves the offset unchanged and is
   **fail-closed**.
3. `WorkspaceUploadStatus` — reconcile current state/offset at any time
   (read-only; also after a reconnect).
4. `WorkspaceUploadCommit` — publish the fully-written file. The daemon
   verifies total length and SHA-256 against the declared digest before an
   atomic rename; a mismatch fails closed. Returns the absolute `path` and
   slash-relative `relative_path`, original `name`, and exact `mime`, with
   `offset == size`.
5. `WorkspaceUploadCancel` — abort an in-progress upload, remove staging, and
   settle the reservation; the cancelled handle remains Status-visible.

Every phase (including Status and cached-receipt replays) is bound to the exact
authenticated device **and** the exact `pane_id` it was begun with, and (except
Cancel) re-resolves the live pane/root and compares it to the original
canonical root. Same root reached through a different pane is forbidden.

### Explicit recovery

If a disconnect interrupts a write, the handle and its expiry timer are
retained; reconnecting as the same device lets the client `Status` (or resume
with `Write` / finish with `Commit`, or `Cancel`) explicitly. This is not
automatic — nothing is retried server-side.

`operation_id` follows the standard mutation format
`op_[A-Za-z0-9_-]{16,128}` and is **not** retried automatically; a
successful receipt is replayed identically for the same id and parameters, and
a failed/uncertain outcome is never re-executed. An `unknown_outcome` commit
tells the phone not to resend it.

## Draft request/response (authoritative shapes live in `rpc.schema.json`)

- `WorkspaceUploadBegin` params:
  `pane_id`, `upload_id`, `operation_id`, `name`, `size`, `sha256`, `mime`.
- `WorkspaceUploadWrite` params:
  `pane_id`, `upload_id`, `operation_id`, `offset`, `data_b64`.
- `WorkspaceUploadStatus` params: `pane_id`, `upload_id` (no `operation_id`).
- `WorkspaceUploadCommit` / `WorkspaceUploadCancel` params:
  `pane_id`, `upload_id`, `operation_id`.

All respond with an `UploadState`: `upload_id`, `state`, `offset`, `size`,
`sha256`, `chunk_bytes`; committed states additionally carry `path`,
`relative_path`, `name`, `mime` and require `offset == size`. Non-committed
states must not carry any final field (`path`/`relative_path`/`name`/`mime`).

## Limits

| Limit | Value |
| --- | --- |
| Chunk | 32 KiB (`data_b64` decodes to at most 32 KiB) |
| Max file size | 20 MiB |
| Reserved pending bytes per device | 40 MiB |
| Active uploads per device | 5 |
| Reserved pending bytes (daemon) | 256 MiB |
| In-memory upload records (active + terminal) | 4096 |
| Operation receipts per upload | 1024 |
| Pending upload lifetime | 24 h (staging aborted) |
| Terminal (committed/cancelled) metadata lifetime | 24 h (files never deleted) |
| Display `name` | ≤ 255 UTF-16 code units, no control characters |
| `mime` | ASCII `type/subtype`, each ≤ 64 units, total ≤ 128, exact regex |
| `sha256` | lowercase 64-hex |
| `base64` | canonical standard base64, no whitespace |
| `offset` | non-negative; must equal acknowledged offset |

`GetConfig.capabilities["upload_file"]` is the single authority for whether
uploads are allowed. Absence (or `false` on an older daemon) means the client
must not offer workspace file uploads.

## Additive, closed, exact

These RPCs add no Worker surface and reuse the frozen error vocabulary. The
`UploadState` schema is exact: additional fields are rejected; a committed
state requires all final fields; a non-committed state rejects every final
field individually (not merely all four together). The server enforces name and
MIME bounds no more permissively than the PWA strict parser, so a client that
parses `UploadState` can rely on the same contract from the daemon.