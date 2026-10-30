package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTraceRootsValidation(t *testing.T) {
	sep := string(os.PathListSeparator)
	dir := t.TempDir()
	for _, name := range []string{"PAIRFOB_CLAUDE_ROOTS", "PAIRFOB_CODEX_ROOTS"} {
		t.Setenv("PAIRFOB_CLAUDE_ROOTS", "")
		t.Setenv("PAIRFOB_CODEX_ROOTS", "")
		if err := validateTraceRoots(); err != nil {
			t.Fatalf("unset: %v", err)
		}
		t.Setenv(name, dir+sep+dir)
		if err := validateTraceRoots(); err != nil {
			t.Fatalf("%s valid: %v", name, err)
		}
		for label, value := range map[string]string{
			"relative": "rel/dir",
			"empty":    dir + sep + sep + dir,
			"missing":  filepath.Join(dir, "missing"),
		} {
			t.Setenv(name, value)
			if err := validateTraceRoots(); err == nil || !strings.Contains(err.Error(), name) {
				t.Errorf("%s %s: err=%v", name, label, err)
			}
		}
	}
}
