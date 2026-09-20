// Attachment (upload) storage for a live workspace root. Uploaded files are
// staged inside the workspace under `.pairfob/attachments/.staging/<uuid>/`,
// hash/size verified, then atomically published at commit into
// `.pairfob/attachments/<uuid>/`. The controlled data basename is derived from
// a small MIME allowlist; the client-supplied original file name is display
// data only and never becomes a path component.
//
// Security posture: the workspace root, the attachment/staging directories and
// the staged data file are pinned by inode at Begin and re-verified at
// publish, so replacement or symlink swaps of any of them fail closed instead
// of publishing unverified bytes. The completed-storage quota scan is bounded
// and fail-closed, and quota-check + publish are serialized process-wide so
// concurrent commits cannot together exceed the per-root quota.
//
// The unix implementation provides full no-follow rooted behaviour; the
// portable stub returns ErrNotSupported so non-unix builds still compile.
package workspace

import (
	"errors"
	"os"
	"strings"
	"sync"
)

const (
	AttachChunkBytes = 32768
	// AttachChunkBytesV2 is the stage-2 per-chunk limit used by WriteAtV2.
	// The legacy wire limit (AttachChunkBytes) is unchanged.
	AttachChunkBytesV2       = 131072
	AttachMaxFileBytes       = 20 << 20 // 20 MiB per file
	AttachMaxBatchBytes      = 40 << 20 // reserved pending bytes per device
	AttachMaxActivePerDevice = 5
	AttachMaxPendingDaemon   = 256 << 20 // reserved pending bytes daemon-wide
	AttachCompletedPerRoot   = 1 << 30   // 1 GiB completed storage per root
)

const (
	attachBaseRel    = ".pairfob/attachments"
	attachStageRel   = ".pairfob/attachments/.staging"
	attachOwnedMark  = ".owned"
	attachIgnoreName = ".gitignore"
	// attachOwnedMagic prefixes the bounded staging ownership marker; the
	// marker's second line names the single controlled data file the
	// staging directory owns. Lazy crash cleanup validates both before
	// removing anything.
	attachOwnedMagic = "pairfob-attachment-stage.v1"
)

// ErrNotSupported is returned on platforms without a secure no-follow
// implementation (non-unix). It is never a wire error.
var ErrNotSupported = errors.New("attachment storage is not supported on this platform")

// safeMimeExt maps a bounded allowlist of MIME types to a controlled ASCII
// extension. Anything not listed falls back to ".bin". MIME is metadata only;
// the client can never inject a path, separator, or extension through the file
// name, and an unknown but valid MIME type still uploads safely.
var safeMimeExt = map[string]string{
	"text/plain":               ".txt",
	"text/markdown":            ".md",
	"application/json":         ".json",
	"application/pdf":          ".pdf",
	"image/png":                ".png",
	"image/jpeg":               ".jpg",
	"image/gif":                ".gif",
	"image/webp":               ".webp",
	"image/svg+xml":            ".svg",
	"application/octet-stream": ".bin",
}

// AttachmentFilename returns the controlled data basename for a MIME type.
// Unknown or empty MIME types fall back to attachment.bin.
func AttachmentFilename(mime string) string {
	ext := safeMimeExt[strings.ToLower(strings.TrimSpace(mime))]
	if ext == "" {
		ext = ".bin"
	}
	return "attachment" + ext
}

// AttachCommitResult reports a publish attempt. Rel is the slash-relative
// committed path. Published is true only when the data file verifiably
// reached that path. With a non-nil ErrMutationUnknown and Published=true the
// rename happened but its durability is unconfirmed: the caller must
// reconcile via ReconcileCommitted (or read-only status) instead of retrying
// the publish (a retry conflicts rather than blindly publishing a second
// time). If a post-rename replacement of the final entry is detected,
// Published stays false with ErrMutationUnknown: an effect occurred but the
// current final entry is not the hashed inode, and a foreign replacement is
// never deleted.
type AttachCommitResult struct {
	Rel       string
	Published bool
}

// AttachStage is one in-progress upload holding its staging data file. It is
// safe for concurrent use by a single active writer (the daemon serializes
// each upload) plus completion paths. Method implementations live in
// attach_unix.go / attach_other.go; this file declares the shape used by the
// daemon so the type and constants are portable.
type AttachStage struct {
	mu        sync.Mutex
	file      *os.File // open O_RDWR data file (unix) / nil (stub)
	root      string   // canonical (symlink-resolved) workspace root pinned at Begin
	serverID  string
	dataName  string // controlled basename
	finalRel  string // slash-relative committed directory (set at Begin)
	size      int64  // declared size (bounds enforcement upper bound)
	wrote     int64  // acknowledged durable bytes
	owned     bool   // staging created by us (.owned marker present)
	committed bool   // publication barrier: publish happened OR may have happened; forbids Cancel/Abort and re-publish
	published bool   // data file verifiably reached the final path
	closed    bool

	// After-publish reconciliation metadata, saved by Commit the moment the
	// rename happens (even on later failure) so ReconcileCommitted can verify
	// the final entry after st.file has been closed: the pinned data inode,
	// the verified digest, the declared size and the final directory inode.
	finalSum    string
	finalSize   int64
	finalDev    uint64
	finalIno    uint64
	finalDirDev uint64
	finalDirIno uint64
	durable     bool // publish verified AND directory chain fsynced

	// Inode pins recorded at Begin and re-verified before any publish or
	// cleanup so a replaced or symlinked path component fails closed
	// (ErrChanged) instead of touching unverified objects. Zero values mean
	// "not pinned" (non-unix stub).
	rootDev, rootIno   uint64
	stageDev, stageIno uint64
	dataDev, dataIno   uint64
}
