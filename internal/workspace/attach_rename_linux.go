//go:build linux

package workspace

import "golang.org/x/sys/unix"

func unixRenameNoReplace(oldDir int, oldName string, newDir int, newName string) error {
	return unix.Renameat2(oldDir, oldName, newDir, newName, unix.RENAME_NOREPLACE)
}
