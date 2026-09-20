# Workspace upload V2 (ordered pipeline)

`WorkspaceUploadBeginV2`, `WorkspaceUploadWriteV2`, `WorkspaceUploadStatusV2`,
`WorkspaceUploadCommitV2`, and `WorkspaceUploadCancelV2` are additive inner
RPCs on an Established Pairfob session. They use the existing encrypted FWD
transport and frozen mutation vocabulary. Crypto and envelope bytes are
untouched: this is a chunk-size, version-binding and per-upload ordering
change only. An older daemon returns `unknown_op`.

## Status of this stage (frozen)

- **Server-side V2 RPCs are implemented and tested**, including the bounded
  ordered write pipeline (max 4 in-flight tickets per upload, durable
  contiguous offsets, out-of-order arrival handling, fail-closed roots).
- **The capability IS advertised.** `GetConfig.capabilities["upload_file_v2"]`
  is `true` (when `upload_file` snapshot support is available), so clients may
  select the 128 KiB V2 upload path at Begin.
- V2 uses a **bounded ordered write pipeline**: up to 4 sequential chunks may
  be in flight per upload, keyed by grid offset. RPC goroutine arrival order
  is not execution order; the gate serializes by byte offset. A successor that
  arrives before its predecessors (e.g. offset 3 admitted before offsets 0/1/2)
  parks and is woken promptly by the change broadcast once those predecessors
  are admitted/settled — it never sleeps out the whole wait-limit.

## Request/response shapes

Request fields are **identical to the legacy counterparts** (including
`operation_id` with the same fresh-operation semantics; no request field is
added or removed):

- `WorkspaceUploadBeginV2` params: `pane_id`, `upload_id`, `operation_id`,
  `name`, `size`, `sha256`, `mime`.
- `WorkspaceUploadWriteV2` params: `pane_id`, `upload_id`, `operation_id`,
  `offset`, `data_b64`.
- `WorkspaceUploadStatusV2` params: `pane_id`, `upload_id` (no `operation_id`).
- `WorkspaceUploadCommitV2` / `WorkspaceUploadCancelV2` params:
  `pane_id`, `upload_id`, `operation_id`.

Responses use the dedicated `workspaceUploadStateV2` schema: the **exact same
`UploadState` keys** as legacy (`upload_id`, `state`, `offset`, `size`,
`sha256`, `chunk_bytes`, plus `path`/`relative_path`/`name`/`mime` on a
committed state, nothing on non-committed states), with
`chunk_bytes = 131072`. The legacy `workspaceUploadState` keeps
`chunk_bytes = 32768` unchanged.

| Limit | Legacy | V2 (this stage) |
| --- | --- | --- |
| Chunk (decoded bytes) | 32768 | 131072 |
| `data_b64` maxLength | 43692 | 174764 |
| Max file size | 20 MiB | 20 MiB (unchanged) |

All other quotas, owner/session/pane/root binding, expiry, terminal-state
handling, cancel intent, and SHA-256/fsync verification are identical to the
legacy upload (see `proto/workspace-upload.md`).

## Version binding (immutable per upload)

The upload protocol version is an internal immutable flag bound at
`WorkspaceUploadBeginV2` **before the entry is published** (stored with the
begin metadata and entry identity; a zero/default value means legacy). Rules:

- The same `upload_id` can never change version: a duplicate
  `WorkspaceUploadBeginV2` whose begin metadata differs only in version
  conflicts (the version is part of the begin fingerprint).
- **Any cross-version `WorkspaceUploadWrite`/`Status`/`Commit`/`Cancel`
  returns `conflict`.** A legacy write on a V2 upload and a V2 write on a
  legacy upload are both rejected before any byte is staged; the check runs
  under the entry lock before receipt replay, so no cross-version receipt is
  ever served.
- The version is **never inferred from chunk size**: the decode bound follows
  the request op, and the entry binding is enforced independently.
- Existing fixtures with a zero/default version remain legacy. Both V1 and V2
  uploads coexist per device and per quota accounting.
- `chunk_bytes` in every receipt reflects the upload's own version so a client
  can never misread the sequential offset plan.

## V2 write grid (stage-3: ordered pipeline)

V2 writes are constrained to a grid: offsets must be multiples of 131072; each
data payload is exactly 131072 bytes except the final remainder, which ends
exactly at the declared size. A zero-byte file uses Begin + Commit only (no
Write). Zero-length, short non-final, unaligned or out-of-window offsets are
rejected before I/O; the legacy path is unchanged.

Up to 4 in-flight sequential chunks are admitted per upload (the bounded
max-4 window). A write whose claim is refused at admission (window full,
duplicate live offset, or an offset outside `[prefix, prefix+4*chunk)`) is
conflict for a new operation; a same-operation redelivery of an already-
settled write replays its cached receipt and never writes. An admitted write
waits bounded on its predecessors under one absolute deadline; out-of-order
arrivals wake via the change broadcast. A gap (no predecessor) fails closed
without writing on timeout/invalidation, and an explicit resume at the settled
prefix starts a fresh admission generation. `StatusV2`/`CommitV2` act as a
synchronous barrier over previously-admitted work. Every write still verifies
authenticated device, live session/pane/root, and re-checks the live ticket
under the entry lock immediately before `WriteAtV2`.

Each V2 write lands through the storage layer's `WriteAtV2`, which keeps
single-file-write, single-fsync, and durable-offset semantics identical to
`WriteAt`. Every write receipt reports `offset` equal to that write's own end
(copied under the entry lock), even if a later write completes first. A
rejected write (oversized for the version, wrong offset, past declared size,
cross-version, invalidated ticket) touches no bytes and never advances the
offset.
