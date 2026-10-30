package main

import (
	"os"

	"pairfob/internal/journal"
)

// validateTraceRoots refuses a bad PAIRFOB_CLAUDE_ROOTS or PAIRFOB_CODEX_ROOTS
// before the daemon opens anything.
func validateTraceRoots() error {
	for _, name := range []string{"PAIRFOB_CLAUDE_ROOTS", "PAIRFOB_CODEX_ROOTS"} {
		if _, err := journal.ParseRoots(name, os.Getenv(name)); err != nil {
			return err
		}
	}
	return nil
}
