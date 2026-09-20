//go:build darwin

package workspace

import "golang.org/x/sys/unix"

func unixRenameNoReplace(oldDir int, oldName string, newDir int, newName string) error {
	return unix.RenameatxNp(oldDir, oldName, newDir, newName, unix.RENAME_EXCL)
}
