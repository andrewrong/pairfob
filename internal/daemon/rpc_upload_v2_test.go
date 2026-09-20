package daemon

// Focused stage-2 V2 upload tests: the five V2 ops, the immutable version
// binding (same upload_id can never switch versions; every cross-version
// call conflicts), the 128 KiB V2 chunk bound vs the frozen 32 KiB legacy
// bound, receipt shapes (chunk_bytes=131072), exact receipts/SHA at commit,
// and reuse of the legacy malformed/op-id/pane/ownership checks.

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"testing"

	"pairfob/internal/phone"
)

func v2Pattern(n int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = byte(i*131 + 17)
	}
	return out
}

func beginV2(t *testing.T, client *phone.Client, uuid, op, name string, data []byte, mime, pane string) map[string]any {
	t.Helper()
	raw, err := client.RPCTimeout("WorkspaceUploadBeginV2", map[string]any{
		"pane_id": pane, "upload_id": uuid, "operation_id": op,
		"name": name, "size": len(data), "sha256": optsChecksum(data), "mime": mime,
	}, testUploadTimeout)
	if err != nil {
		t.Fatalf("begin v2 err=%v", err)
	}
	return decodeResult(t, raw)
}

func writeV2(t *testing.T, client *phone.Client, uuid, op string, offset int, data []byte, pane string) (map[string]any, error) {
	t.Helper()
	raw, err := client.RPCTimeout("WorkspaceUploadWriteV2", map[string]any{
		"pane_id": pane, "upload_id": uuid, "operation_id": op,
		"offset": offset, "data_b64": base64.StdEncoding.EncodeToString(data),
	}, testUploadTimeout)
	if err != nil {
		return nil, err
	}
	return decodeResult(t, raw), nil
}

func statusV2(t *testing.T, client *phone.Client, uuid, pane string) (map[string]any, error) {
	t.Helper()
	raw, err := client.RPCTimeout("WorkspaceUploadStatusV2", map[string]any{
		"pane_id": pane, "upload_id": uuid,
	}, testUploadTimeout)
	if err != nil {
		return nil, err
	}
	return decodeResult(t, raw), nil
}

func commitV2(t *testing.T, client *phone.Client, uuid, op, pane string) (map[string]any, error) {
	t.Helper()
	raw, err := client.RPCTimeout("WorkspaceUploadCommitV2", map[string]any{
		"pane_id": pane, "upload_id": uuid, "operation_id": op,
	}, testUploadTimeout)
	if err != nil {
		return nil, err
	}
	return decodeResult(t, raw), nil
}

func cancelV2(t *testing.T, client *phone.Client, uuid, op, pane string) (map[string]any, error) {
	t.Helper()
	raw, err := client.RPCTimeout("WorkspaceUploadCancelV2", map[string]any{
		"pane_id": pane, "upload_id": uuid, "operation_id": op,
	}, testUploadTimeout)
	if err != nil {
		return nil, err
	}
	return decodeResult(t, raw), nil
}

// readPublishedV2 reads the committed file from its absolute path so the
// test asserts the exact published bytes.
func readPublishedV2(t *testing.T, committed map[string]any) []byte {
	t.Helper()
	path, _ := committed["path"].(string)
	if path == "" {
		t.Fatalf("committed result missing path: %v", committed)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read published v2 file: %v", err)
	}
	return data
}

// TestUploadV2FullLifecycleAndReceiptShape: begin/write/status/commit happy
// path with the V2 ops; every receipt carries the exact UploadState keys
// with chunk_bytes=131072; the committed file matches byte-for-byte with
// the declared SHA-256; a committed upload refuses both V2 and legacy cancel.
func TestUploadV2FullLifecycleAndReceiptShape(t *testing.T) {
	_, _, _, client := uploadFixture(t)
	data := v2Pattern(300000) // 2 full 128 KiB chunks + remainder
	uuid := testUUID(600)

	begin := beginV2(t, client, uuid, "op_v2begin00000000001", "v2.bin", data, "application/octet-stream", "w0:p1")
	if begin["state"] != "uploading" || begin["upload_id"] != uuid || begin["size"] != float64(len(data)) {
		t.Fatalf("begin v2=%v", begin)
	}
	if begin["chunk_bytes"] != float64(131072) {
		t.Fatalf("begin v2 chunk_bytes=%v, want 131072", begin["chunk_bytes"])
	}

	chunk1 := data[:131072]
	chunk2 := data[131072 : 2*131072]
	rest := data[2*131072:]

	w1, err := writeV2(t, client, uuid, "op_v2write00000000001", 0, chunk1, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if w1["offset"] != float64(131072) || w1["state"] != "uploading" || w1["chunk_bytes"] != float64(131072) {
		t.Fatalf("write1 v2=%v", w1)
	}
	w2, err := writeV2(t, client, uuid, "op_v2write00000000002", 131072, chunk2, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if w2["offset"] != float64(2*131072) {
		t.Fatalf("write2 v2 offset=%v", w2["offset"])
	}
	w3, err := writeV2(t, client, uuid, "op_v2write00000000003", 2*131072, rest, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if w3["offset"] != float64(len(data)) {
		t.Fatalf("write3 v2 offset=%v, want %d", w3["offset"], len(data))
	}

	status, err := statusV2(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["state"] != "uploading" || status["offset"] != float64(len(data)) || status["chunk_bytes"] != float64(131072) {
		t.Fatalf("status v2=%v", status)
	}

	committed, err := commitV2(t, client, uuid, "op_v2commit0000000001", "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if committed["state"] != "committed" || committed["offset"] != float64(len(data)) || committed["name"] != "v2.bin" || committed["mime"] != "application/octet-stream" {
		t.Fatalf("committed v2=%v", committed)
	}
	if committed["chunk_bytes"] != float64(131072) {
		t.Fatalf("committed v2 chunk_bytes=%v", committed["chunk_bytes"])
	}
	if committed["relative_path"] == "" || committed["path"] == "" {
		t.Fatalf("committed v2 missing final path: %v", committed)
	}

	published := readPublishedV2(t, committed)
	sum := sha256.Sum256(published)
	if len(published) != len(data) || hex.EncodeToString(sum[:]) != optsChecksum(data) {
		t.Fatalf("published v2 file: %d bytes, sha mismatch (want %d bytes)", len(published), len(data))
	}

	// Committed upload can no longer be cancelled, by either version.
	if _, err := cancelV2(t, client, uuid, "op_v2cancelafter00001", "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("v2 cancel after commit err=%v, want conflict", err)
	}
	if _, err := client.RPCTimeout("WorkspaceUploadCancel", map[string]any{
		"pane_id": "w0:p1", "upload_id": uuid, "operation_id": "op_v2cancelafter00002",
	}, testUploadTimeout); err == nil || err.Error() != "conflict" {
		t.Fatalf("legacy cancel after v2 commit err=%v, want conflict", err)
	}
}

// TestUploadV2ChunkBounds: a V2 write accepts exactly 131072 bytes and
// rejects 131073; the legacy write on the same V2 upload conflicts (version
// binding) rather than being served as a small legacy chunk.
func TestUploadV2ChunkBounds(t *testing.T) {
	_, _, _, client := uploadFixture(t)
	data := make([]byte, 400000)
	uuid := testUUID(601)
	beginV2(t, client, uuid, "op_v2bound00000000001", "bounds.bin", data, "application/octet-stream", "w0:p1")

	full := make([]byte, 131072)
	if _, err := writeV2(t, client, uuid, "op_v2bound00000000002", 0, full, "w0:p1"); err != nil {
		t.Fatalf("v2 write of exactly 131072: %v", err)
	}
	over := make([]byte, 131073)
	if _, err := writeV2(t, client, uuid, "op_v2bound00000000003", 131072, over, "w0:p1"); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("v2 write of 131073 err=%v, want invalid_argument", err)
	}
	// Legacy write on the V2 upload conflicts (version, not chunk size).
	if _, err := uploadWrite(t, client, uuid, "op_v2bound00000000004", 131072, []byte("tiny legacy"), "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("legacy write on v2 upload err=%v, want conflict", err)
	}
	// The over-bound attempt left the offset unchanged.
	status, err := statusV2(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["offset"] != float64(131072) {
		t.Fatalf("offset after rejected v2 writes=%v, want 131072", status["offset"])
	}
}

// TestUploadV2LegacyBoundsUnchanged: the legacy write on a LEGACY upload
// still rejects > 32768 bytes and the V2 ops on a legacy upload conflict.
func TestUploadV2LegacyBoundsUnchanged(t *testing.T) {
	_, _, _, client := uploadFixture(t)
	data := make([]byte, 200000)
	uuid := testUUID(602)
	setUpFS(t, client, uuid, "op_v2legacybound00001", "legacy.bin", data, "application/octet-stream", "w0:p1")

	if _, err := uploadWrite(t, client, uuid, "op_v2legacybound00002", 0, make([]byte, 32769), "w0:p1"); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("legacy 32769-byte write err=%v, want invalid_argument", err)
	}
	if _, err := writeV2(t, client, uuid, "op_v2legacybound00003", 0, make([]byte, 131072), "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("v2 write on legacy upload err=%v, want conflict", err)
	}
	if _, err := statusV2(t, client, uuid, "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("v2 status on legacy upload err=%v, want conflict", err)
	}
	// Legacy status still works on the legacy upload with chunk_bytes=32768.
	status, err := uploadStatus(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["chunk_bytes"] != float64(32768) || status["offset"] != float64(0) {
		t.Fatalf("legacy status=%v", status)
	}
}

// TestUploadV2CrossVersionEveryPhase: for BOTH directions (legacy upload,
// V2 upload), every cross-version Write/Status/Commit/Cancel returns
// conflict, and the wrong-version call never changes state or offset.
func TestUploadV2CrossVersionEveryPhase(t *testing.T) {
	_, _, _, client := uploadFixture(t)

	// Legacy upload, V2 calls.
	legacyData := []byte("legacy owned")
	legacyUUID := testUUID(603)
	setUpFS(t, client, legacyUUID, "op_v2cross0000000001", "legacy.txt", legacyData, "text/plain", "w0:p1")
	if _, err := writeV2(t, client, legacyUUID, "op_v2cross0000000002", 0, []byte("v2 bytes"), "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("v2 write on legacy err=%v", err)
	}
	if _, err := statusV2(t, client, legacyUUID, "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("v2 status on legacy err=%v", err)
	}
	if _, err := commitV2(t, client, legacyUUID, "op_v2cross0000000003", "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("v2 commit on legacy err=%v", err)
	}
	if _, err := cancelV2(t, client, legacyUUID, "op_v2cross0000000004", "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("v2 cancel on legacy err=%v", err)
	}
	// Legacy path still fully usable.
	if _, err := uploadWrite(t, client, legacyUUID, "op_v2cross0000000005", 0, legacyData, "w0:p1"); err != nil {
		t.Fatalf("legacy write after cross-version attempts: %v", err)
	}

	// V2 upload, legacy calls.
	v2Data := make([]byte, 262144)
	v2UUID := testUUID(604)
	beginV2(t, client, v2UUID, "op_v2cross0000000006", "crossv2.bin", v2Data, "application/octet-stream", "w0:p1")
	if _, err := uploadWrite(t, client, v2UUID, "op_v2cross0000000007", 0, []byte("legacy bytes"), "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("legacy write on v2 err=%v", err)
	}
	if _, err := uploadStatus(t, client, v2UUID, "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("legacy status on v2 err=%v", err)
	}
	if _, err := client.RPCTimeout("WorkspaceUploadCommit", map[string]any{
		"pane_id": "w0:p1", "upload_id": v2UUID, "operation_id": "op_v2cross0000000008",
	}, testUploadTimeout); err == nil || err.Error() != "conflict" {
		t.Fatalf("legacy commit on v2 err=%v", err)
	}
	if _, err := client.RPCTimeout("WorkspaceUploadCancel", map[string]any{
		"pane_id": "w0:p1", "upload_id": v2UUID, "operation_id": "op_v2cross0000000009",
	}, testUploadTimeout); err == nil || err.Error() != "conflict" {
		t.Fatalf("legacy cancel on v2 err=%v", err)
	}
	// V2 path still fully usable; nothing above moved the offset.
	status, err := statusV2(t, client, v2UUID, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["state"] != "uploading" || status["offset"] != float64(0) {
		t.Fatalf("v2 status after cross-version attempts=%v", status)
	}
}

// TestUploadV2DuplicateBeginVersionConflict: re-beginning the same
// upload_id with the same version replays the receipt; the identical begin
// metadata with a DIFFERENT version conflicts and never switches the entry.
func TestUploadV2DuplicateBeginVersionConflict(t *testing.T) {
	_, _, _, client := uploadFixture(t)
	data := []byte("version pinned")
	uuid := testUUID(605)
	beginOp := "op_v2dup00000000000001"
	begin := beginV2(t, client, uuid, beginOp, "dup.bin", data, "application/octet-stream", "w0:p1")

	// Same version, same metadata: identical receipt replay.
	replayed, err := client.RPCTimeout("WorkspaceUploadBeginV2", map[string]any{
		"pane_id": "w0:p1", "upload_id": uuid, "operation_id": beginOp,
		"name": "dup.bin", "size": len(data), "sha256": optsChecksum(data), "mime": "application/octet-stream",
	}, testUploadTimeout)
	if err != nil {
		t.Fatal(err)
	}
	if string(replayed) != string(mustJSON(t, begin)) {
		t.Fatalf("v2 begin replay changed: first=%s second=%s", mustJSON(t, begin), replayed)
	}

	// Identical begin metadata but legacy version: conflict, never a switch.
	if _, err := client.RPCTimeout("WorkspaceUploadBegin", map[string]any{
		"pane_id": "w0:p1", "upload_id": uuid, "operation_id": "op_v2dup00000000000002",
		"name": "dup.bin", "size": len(data), "sha256": optsChecksum(data), "mime": "application/octet-stream",
	}, testUploadTimeout); err == nil || err.Error() != "conflict" {
		t.Fatalf("legacy duplicate begin with different version err=%v, want conflict", err)
	}

	// The entry is still V2 and still uploading.
	status, err := statusV2(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["chunk_bytes"] != float64(131072) || status["state"] != "uploading" {
		t.Fatalf("entry changed version after conflicting duplicate begin: %v", status)
	}
}

// TestUploadV2MalformedAndOwnership: V2 ops reuse the legacy strict
// validation (malformed params, bad ids) and the device/pane binding.
func TestUploadV2MalformedAndOwnership(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := []byte("owned v2 content")
	uuid := testUUID(606)
	beginV2(t, client, uuid, "op_v2own0000000000001", "own.bin", data, "application/octet-stream", "w0:p1")

	// Malformed: unknown field, bad upload_id, bad operation_id, bad base64,
	// whitespace base64 — all invalid_argument, exactly like legacy.
	if _, err := client.RPCTimeout("WorkspaceUploadBeginV2", map[string]any{
		"pane_id": "w0:p1", "upload_id": testUUID(607), "operation_id": "op_v2own0000000000002",
		"name": "x.bin", "size": 1, "sha256": optsChecksum(data), "mime": "application/octet-stream", "surprise": true,
	}, testUploadTimeout); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("unknown field err=%v", err)
	}
	if _, err := client.RPCTimeout("WorkspaceUploadWriteV2", map[string]any{
		"pane_id": "w0:p1", "upload_id": "not-a-uuid", "operation_id": "op_v2own0000000000003",
		"offset": 0, "data_b64": base64.StdEncoding.EncodeToString([]byte("x")),
	}, testUploadTimeout); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("bad upload_id err=%v", err)
	}
	if _, err := commitV2(t, client, uuid, "shortop", "w0:p1"); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("bad operation_id err=%v", err)
	}
	if _, err := client.RPCTimeout("WorkspaceUploadWriteV2", map[string]any{
		"pane_id": "w0:p1", "upload_id": uuid, "operation_id": "op_v2own0000000000004",
		"offset": 0, "data_b64": "not base64!!",
	}, testUploadTimeout); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("bad base64 err=%v", err)
	}
	if _, err := client.RPCTimeout("WorkspaceUploadWriteV2", map[string]any{
		"pane_id": "w0:p1", "upload_id": uuid, "operation_id": "op_v2own0000000000005",
		"offset": 0, "data_b64": base64.StdEncoding.EncodeToString([]byte("x")) + " ",
	}, testUploadTimeout); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("whitespace base64 err=%v", err)
	}

	// Wrong device must not see the V2 upload.
	other := attachPhone(t, engine)
	if _, err := statusV2(t, other, uuid, "w0:p1"); err == nil || err.Error() != "workspace_not_found" {
		t.Fatalf("other device status err=%v", err)
	}
	if _, err := writeV2(t, other, uuid, "op_v2own0000000000006", 0, []byte("steal"), "w0:p1"); err == nil || err.Error() != "workspace_not_found" {
		t.Fatalf("other device write err=%v", err)
	}
}

// TestUploadV2CancelLifecycle: a V2 cancel settles the upload, releases the
// quota, and leaves the handle Status-visible as cancelled; cross-version
// Status then reports conflict (the version binding holds after cancel).
func TestUploadV2CancelLifecycle(t *testing.T) {
	_, _, engine, client := uploadFixture(t)
	data := []byte("cancel me")
	uuid := testUUID(609)
	beginV2(t, client, uuid, "op_v2cancel00000000001", "cancel.bin", data, "application/octet-stream", "w0:p1")

	cancelled, err := cancelV2(t, client, uuid, "op_v2cancel00000000002", "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if cancelled["state"] != "cancelled" || cancelled["chunk_bytes"] != float64(131072) {
		t.Fatalf("cancelled v2=%v", cancelled)
	}

	engine.uploads.mu.Lock()
	pending, active := engine.uploads.pendingBytes, engine.uploads.active
	engine.uploads.mu.Unlock()
	if pending != 0 || active != 0 {
		t.Fatalf("v2 cancel leaked quota: pending=%d active=%d", pending, active)
	}

	status, err := statusV2(t, client, uuid, "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if status["state"] != "cancelled" {
		t.Fatalf("v2 status after cancel=%v", status)
	}
	if _, err := uploadStatus(t, client, uuid, "w0:p1"); err == nil || err.Error() != "conflict" {
		t.Fatalf("legacy status after v2 cancel err=%v, want conflict", err)
	}
}

// TestUploadV2EmptyFileBeginCommitOnly: a zero-byte V2 upload commits with
// no writes at all (stage-3 frozen grid rule; already valid in stage-2
// because the offset check is offset == size == 0).
func TestUploadV2EmptyFileBeginCommitOnly(t *testing.T) {
	_, _, _, client := uploadFixture(t)
	uuid := testUUID(610)
	begin := beginV2(t, client, uuid, "op_v2empty00000000001", "empty.bin", []byte{}, "application/octet-stream", "w0:p1")
	if begin["size"] != float64(0) || begin["offset"] != float64(0) {
		t.Fatalf("empty begin=%v", begin)
	}
	committed, err := commitV2(t, client, uuid, "op_v2empty00000000002", "w0:p1")
	if err != nil {
		t.Fatal(err)
	}
	if committed["state"] != "committed" || committed["offset"] != float64(0) {
		t.Fatalf("empty commit=%v", committed)
	}
	if published := readPublishedV2(t, committed); len(published) != 0 {
		t.Fatalf("empty upload published %d bytes", len(published))
	}
}
