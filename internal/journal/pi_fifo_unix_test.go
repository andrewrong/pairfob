//go:build unix

package journal

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestPiPathFIFOIsRejectedBeforeOpen(t *testing.T) {
	root := t.TempDir()
	sessions := filepath.Join(root, "sessions")
	if err := os.MkdirAll(sessions, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(sessions, "blocked.jsonl")
	if err := syscall.Mkfifo(path, 0o600); err != nil {
		t.Skipf("mkfifo unavailable: %v", err)
	}
	reader := &Reader{PiRoot: root}
	ref := Ref{Source: "herdr:pi", Agent: "pi", Kind: "path", Value: path}

	done := make(chan error, 1)
	go func() {
		if reader.Available(ref) {
			done <- errors.New("FIFO reported available")
			return
		}
		_, err := reader.Read(ref, nil, 20)
		if !errors.Is(err, ErrUnavailable) {
			done <- errors.New("FIFO read did not return ErrUnavailable")
			return
		}
		done <- nil
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("FIFO validation blocked while opening the transcript")
	}
}
