//go:build !unix

package journal

func activityOpenFlags() int { return 0 }
