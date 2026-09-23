package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	goruntime "runtime"
	"strings"
	"testing"
)

// Opt-in integration check using a nonexistent credential. No real login is read.
func TestQuotaKeychainNativeQuery(t *testing.T) {
	if goruntime.GOOS != "darwin" || os.Getenv("PAIRFOB_TEST_KEYCHAIN") != "1" {
		t.Skip("set PAIRFOB_TEST_KEYCHAIN=1 on macOS")
	}
	_, err := quotaKeychainRead(context.Background(), "pairfob-nonexistent-quota-test-credential", "pairfob-test", 16384)
	if !errors.Is(err, errQuotaKeychainNotFound) {
		t.Fatalf("native query failed instead of reporting missing item: %v", err)
	}
}

func TestClaudeQuotaSecurityProcess(t *testing.T) {
	if os.Getenv("PAIRFOB_CLAUDE_SECURITY_FIXTURE") != "1" {
		return
	}
	fmt.Print(`{"claudeAiOauth":{"accessToken":"fixture-token","scopes":["user:profile"]},"padding":"` + strings.Repeat("x", 20000) + `"}` + "\n")
	os.Exit(0)
}

func TestQuotaKeychainPreservesClaudeCredentialJSON(t *testing.T) {
	t.Setenv("PAIRFOB_CLAUDE_SECURITY_FIXTURE", "1")
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := runQuotaKeychain(context.Background(), 1024*1024, binary, "-test.run=^TestClaudeQuotaSecurityProcess$")
	if err != nil {
		t.Fatal(err)
	}
	var auth claudeQuotaAuth
	if json.Unmarshal(raw, &auth) != nil || auth.OAuth.AccessToken != "fixture-token" || len(auth.OAuth.Scopes) != 1 {
		t.Fatal("Claude credential JSON was truncated or changed")
	}
}
