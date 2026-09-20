package journal

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func clipEventPromptly(t *testing.T, event Event, limit int, already bool) (Event, bool) {
	t.Helper()
	type result struct {
		event     Event
		truncated bool
	}
	done := make(chan result, 1)
	go func() {
		clipped, truncated := clipEventToLimit(event, limit, already)
		done <- result{event: clipped, truncated: truncated}
	}()
	select {
	case got := <-done:
		return got.event, got.truncated
	case <-time.After(time.Second):
		t.Fatal("clipEventToLimit did not terminate")
		return Event{}, false
	}
}

func TestClipEventToLimitMakesProgressForFiveAndSixByteFields(t *testing.T) {
	for _, text := range []string{"abcde", "abcdef"} {
		t.Run(text, func(t *testing.T) {
			base := Event{Type: "tool", Name: "read"}
			limit := eventSize(base)
			got, truncated := clipEventPromptly(t, Event{Type: base.Type, Name: base.Name, Output: text}, limit, false)
			if !truncated || eventSize(got) > limit {
				t.Fatalf("got=%+v size=%d truncated=%v", got, eventSize(got), truncated)
			}
		})
	}
}

func TestClipEventToLimitKeepsUTF8Valid(t *testing.T) {
	base := Event{Type: "assistant"}
	got, truncated := clipEventPromptly(t, Event{Type: "assistant", Text: "甲乙丙丁尾"}, eventSize(base)+6, false)
	if !truncated || !utf8.ValidString(got.Text) || eventSize(got) > eventSize(base)+6 {
		t.Fatalf("got=%q size=%d valid=%v truncated=%v", got.Text, eventSize(got), utf8.ValidString(got.Text), truncated)
	}
}

func TestClipEventToLimitReturnsOversizedMetadataForCallerToReject(t *testing.T) {
	for _, limit := range []int{-1, 0, 1} {
		got, truncated := clipEventPromptly(t, Event{Type: "tool", Name: "metadata"}, limit, false)
		if got.Type != "tool" || got.Name != "metadata" || truncated || eventSize(got) <= limit {
			t.Fatalf("limit=%d got=%+v size=%d truncated=%v", limit, got, eventSize(got), truncated)
		}

		withPayload, clipped := clipEventPromptly(t, Event{Type: "tool", Name: "metadata", Output: "abcde"}, limit, false)
		if !clipped || withPayload.Output != "" || eventSize(withPayload) <= limit {
			t.Fatalf("payload limit=%d got=%+v size=%d truncated=%v", limit, withPayload, eventSize(withPayload), clipped)
		}
	}
}

func TestClipEventToLimitBoundsLargeToolTail(t *testing.T) {
	const limit = 512
	input := strings.Repeat("参数<>&", 8_000)
	output := strings.Repeat("output-", 20_000)
	got, truncated := clipEventPromptly(t, Event{Type: "tool", Name: "exec_command", Input: input, Output: output}, limit, false)
	if !truncated || eventSize(got) > limit {
		t.Fatalf("size=%d truncated=%v", eventSize(got), truncated)
	}
	if got.Type != "tool" || got.Name != "exec_command" || !utf8.ValidString(got.Input) || !utf8.ValidString(got.Output) {
		t.Fatalf("metadata or UTF-8 damaged: %+v", got)
	}
}
