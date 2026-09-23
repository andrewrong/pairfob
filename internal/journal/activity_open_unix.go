//go:build unix

package journal

import "golang.org/x/sys/unix"

func activityOpenFlags() int { return unix.O_NOFOLLOW | unix.O_NONBLOCK }
