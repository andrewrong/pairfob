//go:build !unix

package workspace

import "errors"

// renameAt is never called on non-unix platforms (the store stub returns
// ErrNotSupported); it exists only so the build has a definition.
func renameAt(oldDir int, oldName string, newDir int, newName string) error {
	return errors.New("attachment publish unsupported")
}
