package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const serviceStartupLogRel = "pairfob-startup.log"

// configuredLogDir keeps runtime logs separate from device keys when a host
// deployment chooses a dedicated, private log directory.
func configuredLogDir(stateDir string) (string, error) {
	dir := os.Getenv("PAIRFOB_LOG_DIR")
	if dir == "" {
		return stateDir, nil
	}
	if !filepath.IsAbs(dir) {
		return "", errors.New("PAIRFOB_LOG_DIR must be an absolute path")
	}
	return filepath.Clean(dir), nil
}

func ensurePrivateLogDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("log path must be a real directory: %s", dir)
	}
	return os.Chmod(dir, 0o700)
}

func prepareServiceLog(path string) error {
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("service log path must be a regular file: %s", path)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

// redirectDaemonLog opens no file: the daemon log goes to stdout/stderr, and
// the service manager's log (bounded by its host) holds it. It only checks that
// a configured PAIRFOB_LOG_DIR is usable for audit.log.
func redirectDaemonLog(stateDir string) error {
	if stdoutIsTTY() {
		return nil // An interactive foreground invocation keeps its terminal output.
	}
	dir, err := configuredLogDir(stateDir)
	if err != nil {
		return err
	}
	return ensurePrivateLogDir(dir)
}
