package audit

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const mb = 1024 * 1024

func writeMB(l *Logger, total int) {
	pad := strings.Repeat("x", 4000)
	n := total * mb / 4100
	var wg sync.WaitGroup
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < n/4; i++ {
				l.Event("test", map[string]any{"pad": pad})
			}
		}()
	}
	wg.Wait()
}

func backups(t *testing.T, dir string) []string {
	t.Helper()
	m, err := filepath.Glob(filepath.Join(dir, "audit-*.log"))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func waitBackups(t *testing.T, dir string, want int) []string {
	t.Helper()
	var m []string
	for i := 0; i < 100; i++ {
		if m = backups(t, dir); len(m) == want {
			return m
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("backups = %v, want %d", m, want)
	return nil
}

func TestAuditRotatesAt50MBKeepingOneOlderCopy(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	l, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	writeMB(l, 55)
	first := waitBackups(t, dir, 1)
	if info, err := os.Stat(path); err != nil || info.Size() > 50*mb+8192 {
		t.Fatalf("audit.log = %v, %v", info, err)
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("audit.log mode: %v, %v", info, err)
	}
	// A second rotation replaces the older copy.
	writeMB(l, 50)
	second := waitBackups(t, dir, 1)
	if second[0] == first[0] {
		t.Fatalf("older copy %s was not replaced", first[0])
	}
	if info, err := os.Stat(path); err != nil || info.Size() > 50*mb+8192 {
		t.Fatalf("audit.log after second rotation = %v, %v", info, err)
	}
}

func TestAuditRecordAfterRotationIsReadable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	l, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	writeMB(l, 51)
	waitBackups(t, dir, 1)
	l.Event("after_rotation", map[string]any{"k": "v"})
	data, err := os.ReadFile(path)
	if err != nil || !bytes.Contains(data, []byte(`"op":"after_rotation"`)) {
		t.Fatalf("new audit.log lacks the record: err=%v", err)
	}
}
