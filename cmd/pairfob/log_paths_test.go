package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/natefinch/lumberjack.v2"

	"pairfob/internal/audit"
	"pairfob/internal/state"
)

func TestRedirectDaemonLogOpensNoFile(t *testing.T) {
	logDir := filepath.Join(t.TempDir(), "logs")
	t.Setenv("PAIRFOB_LOG_DIR", logDir)
	stdout, stderr, out := os.Stdout, os.Stderr, log.Writer()
	if err := redirectDaemonLog(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if os.Stdout != stdout || os.Stderr != stderr || log.Writer() != out {
		t.Fatal("redirectDaemonLog replaced stdout, stderr or the log output")
	}
	if _, err := os.Stat(filepath.Join(logDir, "pairfob.log")); !os.IsNotExist(err) {
		t.Fatalf("pairfob.log created: %v", err)
	}
}

// The start path as main enters it: redirectDaemonLog, then runDaemon, which
// opens audit.log. The daemon stops at the invalid origin, after the audit open.
func TestDaemonStartCreatesNoServiceLogAndRotatesAudit(t *testing.T) {
	root, err := os.MkdirTemp("", "pf")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	logDir := filepath.Join(root, "logs")
	t.Setenv("PAIRFOB_STATE_DIR", filepath.Join(root, "state"))
	t.Setenv("PAIRFOB_LOG_DIR", logDir)
	t.Setenv("PAIRFOB_DEV_FAKE_RUNTIME", "1")
	t.Setenv("PAIRFOB_ORIGIN", "http://127.0.0.1:1")
	t.Setenv("PAIRFOB_LISTEN_ADDR", "127.0.0.1:0")
	store, err := state.Open("")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(store.AuditPath()) != "audit.log" {
		t.Fatalf("AuditPath = %s", store.AuditPath())
	}
	if err := redirectDaemonLog(store.Dir); err != nil {
		t.Fatal(err)
	}
	var opened *audit.Logger
	onAuditOpen = func(l *audit.Logger) { opened = l }
	t.Cleanup(func() { onAuditOpen = nil })
	_ = runDaemon(store, filepath.Join(root, "s"))
	if opened == nil {
		t.Fatal("runDaemon never opened the audit log")
	}
	if _, ok := opened.Writer().(*lumberjack.Logger); !ok {
		t.Fatalf("audit writer is %T, want *lumberjack.Logger", opened.Writer())
	}
	if _, err := os.Stat(filepath.Join(logDir, "pairfob.log")); !os.IsNotExist(err) {
		t.Fatalf("pairfob.log created: %v", err)
	}
}

func TestCustomLogDirectoryKeepsStateSeparate(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(root, "state")
	logDir := filepath.Join(root, "service", "logs")
	t.Setenv("PAIRFOB_STATE_DIR", stateDir)
	t.Setenv("PAIRFOB_LOG_DIR", logDir)

	layout, err := currentServiceLayout()
	if err != nil {
		t.Fatal(err)
	}
	if layout.StateDir != stateDir || layout.LogPath != filepath.Join(logDir, "pairfob.log") {
		t.Fatalf("service paths: state=%q log=%q", layout.StateDir, layout.LogPath)
	}
	if err := ensurePrivateLogDir(logDir); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(logDir)
	if err != nil || info.Mode().Perm() != 0o700 {
		t.Fatalf("log directory mode: %v, %v", info, err)
	}
	logger, err := audit.Open(filepath.Join(logDir, "audit.log"))
	if err != nil {
		t.Fatal(err)
	}
	if err := logger.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, "audit.log")); !os.IsNotExist(err) {
		t.Fatalf("audit log unexpectedly in state: %v", err)
	}
	if !strings.Contains(launchdRuntimeEnvironment(), logDir) || !strings.Contains(systemdRuntimeEnvironment(), logDir) {
		t.Fatal("service did not retain the custom log directory")
	}
	for _, osName := range []string{"darwin", "linux"} {
		layout.GOOS = osName
		body := unitBody(layout)
		if strings.Contains(body, logDir+"/pairfob.log") {
			t.Fatalf("custom %s service asks its manager to open the external log: %s", osName, body)
		}
		if !strings.Contains(body, filepath.Join(stateDir, "pairfob-startup.log")) {
			t.Fatalf("custom %s service does not send startup output to the state directory: %s", osName, body)
		}
	}
}

func TestLogDirectoryRejectsRelativePathAndSymlink(t *testing.T) {
	t.Setenv("PAIRFOB_LOG_DIR", "relative/logs")
	if _, err := configuredLogDir(t.TempDir()); err == nil {
		t.Fatal("accepted a relative log directory")
	}
	root := t.TempDir()
	real := filepath.Join(root, "real")
	link := filepath.Join(root, "link")
	if err := os.Mkdir(real, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	if err := ensurePrivateLogDir(link); err == nil {
		t.Fatal("accepted a symlink log directory")
	}
	logLink := filepath.Join(root, "pairfob.log")
	if err := os.Symlink(filepath.Join(root, "target.log"), logLink); err != nil {
		t.Fatal(err)
	}
	if err := prepareServiceLog(logLink); err == nil {
		t.Fatal("accepted a symlink service log")
	}
}
