//go:build !unix

package workspace

// Portable stubs: the secure no-follow storage layer is unix-only. Non-unix
// builds compile with these, but every operation fails closed.

func setAttachHook(fn func(stage, rel string)) func() {
	return func() {}
}

func BeginAttachment(root, serverID, mime string, size int64) (*AttachStage, error) {
	return nil, ErrNotSupported
}

func (st *AttachStage) FinalRel() string { return "" }
func (st *AttachStage) ServerID() string { return st.serverID }
func (st *AttachStage) DataName() string { return st.dataName }
func (st *AttachStage) Wrote() int64     { return 0 }
func (st *AttachStage) Committed() bool  { return false }

func (st *AttachStage) WriteAt(offset int64, data []byte) error {
	return ErrNotSupported
}

func (st *AttachStage) WriteAtV2(offset int64, data []byte) error {
	return ErrNotSupported
}

func (st *AttachStage) Commit(declaredSize int64, sha256hex string) (AttachCommitResult, error) {
	return AttachCommitResult{}, ErrNotSupported
}

// ReconcileCommitted is unsupported on non-unix platforms.
func (st *AttachStage) ReconcileCommitted() (AttachCommitResult, error) {
	return AttachCommitResult{}, ErrNotSupported
}

func (st *AttachStage) Close() error { return nil }

func (st *AttachStage) Abort() error { return ErrNotSupported }

func AttachCompletedBytes(root string) (int64, error) {
	return 0, ErrNotSupported
}

func AttachCleanupExpired(root string, olderAgo int64, activeIDs []string) (int, error) {
	return 0, ErrNotSupported
}
