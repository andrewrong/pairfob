package runtime

import (
	"context"
	"errors"
)

const cursorQuotaTokenLimit = 16384

func cursorQuotaKeychain(ctx context.Context) (string, string) {
	raw, err := quotaKeychainRead(ctx, "cursor-access-token", "cursor-user", cursorQuotaTokenLimit)
	return cursorQuotaKeychainResult(raw, err)
}

func cursorQuotaKeychainResult(raw []byte, err error) (string, string) {
	if errors.Is(err, errQuotaKeychainNotFound) {
		return "", "not_logged_in"
	}
	if err != nil {
		return "", "auth_required"
	}
	return string(raw), ""
}
