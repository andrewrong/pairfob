// Package audit writes security-relevant daemon events as one JSON object per
// line. It deliberately accepts structured fields so callers can omit secrets.
package audit

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"gopkg.in/natefinch/lumberjack.v2"
)

// Rotation bounds audit.log: one live file of at most maxSizeMB plus one older
// copy (audit-<timestamp>.log), so a daemon keeps at most about 100 MB of
// audit records. Rotation drops the oldest records once a second rotation
// replaces the older copy.
const (
	maxSizeMB  = 50
	maxBackups = 1
)

type Logger struct {
	mu sync.Mutex
	w  io.WriteCloser
}

// Writer returns the rotating writer the Logger appends to.
func (l *Logger) Writer() io.WriteCloser { return l.w }

func Open(path string) (*Logger, error) {
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("audit path must be a regular file")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	if err := f.Chmod(0600); err != nil {
		_ = f.Close()
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	return &Logger{w: &lumberjack.Logger{Filename: path, MaxSize: maxSizeMB, MaxBackups: maxBackups}}, nil
}

func (l *Logger) Event(op string, fields map[string]any) {
	if l == nil || l.w == nil {
		return
	}
	record := make(map[string]any, len(fields)+2)
	record["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	record["op"] = op
	for k, v := range fields {
		record[k] = v
	}
	b, err := json.Marshal(record)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = l.w.Write(append(b, '\n'))
}

func (l *Logger) Close() error {
	if l == nil || l.w == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Close()
}
