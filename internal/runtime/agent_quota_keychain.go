package runtime

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"
)

var errQuotaKeychainNotFound = errors.New("quota credential not found")

// Use the CLI-compatible security reader: its Keychain authorization can differ
// from osascript. macOS may request access; never unlock or change access rules.
func quotaKeychainRead(ctx context.Context, service, account string, limit int) ([]byte, error) {
	args := []string{"find-generic-password", "-s", service, "-w"}
	if account != "" {
		args = append(args, "-a", account)
	}
	return runQuotaKeychain(ctx, limit, "/usr/bin/security", args...)
}

func runQuotaKeychain(parent context.Context, limit int, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = 200 * time.Millisecond
	// security -w adds a newline. Bound stdout and discard potentially private stderr.
	out := &quotaOutput{limit: limit + 1}
	cmd.Stdout = out
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if ctx.Err() == nil && errors.As(err, &exit) && exit.ExitCode() == 44 {
			return nil, errQuotaKeychainNotFound
		}
		return nil, errors.New("quota credential unavailable")
	}
	value := strings.TrimSpace(out.String())
	if value == "" || len(value) > limit {
		return nil, errors.New("quota credential unavailable")
	}
	return []byte(value), nil
}
