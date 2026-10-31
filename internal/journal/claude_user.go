package journal

import (
	"encoding/json"
	"strings"
	"time"
)

// Claude writes the owner's words as `user` entries, but also stores prompts
// typed while the session was busy as `queued_command` attachments, and
// injects its own text (task notifications, reminders) as `user` entries.
// These helpers let history and trace show the first and hide the second.

// claudeDuplicateWindow is how close a queued prompt and a user entry of the
// same text must be to count as one message.
const claudeDuplicateWindow = time.Minute

var claudeInjectedPrefixes = []string{
	"<task-notification>",
	"<cross-session-message",
	"<system-reminder>",
	"<local-command-",
	"<command-name>",
	"<command-message>",
	"<command-args>",
	"<bash-input>",
	"<bash-stdout>",
	"<bash-stderr>",
	"This session is being continued from a previous conversation",
}

// claudeOrigin is the `origin` field of an entry. Only its kind matters; a
// shape other than an object with a string kind reads as no kind.
type claudeOrigin struct{ Kind string }

func (o *claudeOrigin) UnmarshalJSON(data []byte) error {
	var obj struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(data, &obj) == nil {
		o.Kind = obj.Kind
	}
	return nil
}

type claudeAttachment struct {
	Type      string       `json:"type"`
	Origin    claudeOrigin `json:"origin"`
	HumanTurn bool         `json:"humanTurn"`
	Timestamp string       `json:"timestamp"`
	Prompt    string       `json:"prompt"`
}

// claudeQueuedPrompt returns the owner's text of a queued_command attachment.
func claudeQueuedPrompt(a claudeAttachment) (string, time.Time, bool) {
	if a.Type != "queued_command" || a.Origin.Kind != "human" || !a.HumanTurn || a.Prompt == "" {
		return "", time.Time{}, false
	}
	return a.Prompt, parseClaudeTime(a.Timestamp), true
}

func parseClaudeTime(text string) time.Time {
	at, err := time.Parse(time.RFC3339Nano, text)
	if err != nil {
		return time.Time{}
	}
	return at
}

// claudeUserEntryShown reports whether a user entry can hold the owner's text.
func claudeUserEntryShown(isMeta, compactSummary, transcriptOnly bool, origin claudeOrigin) bool {
	return !isMeta && !compactSummary && !transcriptOnly && (origin.Kind == "" || origin.Kind == "human")
}

func claudeInjectedText(text string) bool {
	text = strings.TrimSpace(text)
	for _, prefix := range claudeInjectedPrefixes {
		if strings.HasPrefix(text, prefix) {
			return true
		}
	}
	return false
}

// claudeDedup pairs a queued prompt with the user entry of the same text that
// may follow or precede it. Each pairs once. Its memory is one read: a pair
// split by a page boundary is shown twice.
type claudeDedup struct {
	queued map[string]time.Time
	users  map[string]time.Time
}

func newClaudeDedup() *claudeDedup {
	return &claudeDedup{queued: map[string]time.Time{}, users: map[string]time.Time{}}
}

// seenQueued reports whether a user entry of the text already stands for the
// queued prompt; otherwise it remembers the prompt.
func (d *claudeDedup) seenQueued(text string, at time.Time) bool {
	return d.pair(d.users, d.queued, text, at)
}

// seenUser is seenQueued for a user entry.
func (d *claudeDedup) seenUser(text string, at time.Time) bool {
	return d.pair(d.queued, d.users, text, at)
}

func (d *claudeDedup) pair(other, own map[string]time.Time, text string, at time.Time) bool {
	if at.IsZero() {
		return false
	}
	if seen, ok := other[text]; ok {
		delete(other, text)
		if gap := at.Sub(seen); gap < claudeDuplicateWindow && gap > -claudeDuplicateWindow {
			return true
		}
	}
	own[text] = at
	return false
}
