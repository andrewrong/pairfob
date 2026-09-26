package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"pairfob/internal/audit"
)

func TestRedirectDaemonLogWritesToCustomDirectory(t *testing.T) {
	if os.Getenv("PAIRFOB_TEST_LOG_REDIRECT") == "1" {
		if err := redirectDaemonLog(t.TempDir()); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintln(os.Stdout, "stdout marker")
		log.Print("logger marker")
		return
	}
	logDir := filepath.Join(t.TempDir(), "logs")
	cmd := exec.Command(os.Args[0], "-test.run=^TestRedirectDaemonLogWritesToCustomDirectory$")
	cmd.Env = append(os.Environ(), "PAIRFOB_TEST_LOG_REDIRECT=1", "PAIRFOB_LOG_DIR="+logDir)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("redirected process: %v, output=%q", err, output)
	} else if len(output) != 0 {
		t.Fatalf("daemon output escaped the log file: %q", output)
	}
	data, err := os.ReadFile(filepath.Join(logDir, "pairfob.log"))
	if err != nil || !strings.Contains(string(data), "stdout marker") || !strings.Contains(string(data), "logger marker") {
		t.Fatalf("custom service log = %q, err = %v", data, err)
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
		if strings.Contains(body, logDir+"/pairfob.log") || (!strings.Contains(body, "/dev/null") && !strings.Contains(body, "StandardOutput=null")) {
			t.Fatalf("custom %s service still asks its manager to open the external log: %s", osName, body)
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
