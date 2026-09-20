package daemon

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestNotifyHerdPrunesExpiredDebounceEntries(t *testing.T) {
	now := time.Now()
	engine := &Engine{
		Devices: map[string]*Device{},
		pushLast: map[string]time.Time{
			"expired": now.Add(-pushDebounce),
			"recent":  now.Add(-pushDebounce + time.Second),
		},
	}
	if err := engine.notifyHerd(context.Background(), HerdPush{HerdID: "w0:p1", Kind: PushDone}); err != nil {
		t.Fatal(err)
	}
	if _, ok := engine.pushLast["expired"]; ok {
		t.Fatal("expired debounce entry was retained")
	}
	if _, ok := engine.pushLast["recent"]; !ok {
		t.Fatal("recent debounce entry was pruned")
	}
}

func TestPushDebounceSuppressesRecentAndAdmitsNewSequence(t *testing.T) {
	now := time.Now()
	engine := &Engine{pushLast: make(map[string]time.Time)}
	if !engine.admitPushLocked("device\x00pane\x00done\x001", now) {
		t.Fatal("first sequence was not admitted")
	}
	if engine.admitPushLocked("device\x00pane\x00done\x001", now.Add(time.Second)) {
		t.Fatal("recent duplicate was admitted")
	}
	if !engine.admitPushLocked("device\x00pane\x00done\x002", now.Add(time.Second)) {
		t.Fatal("new sequence was suppressed")
	}
}

func TestPushDebounceHardCapEvictsOldest(t *testing.T) {
	now := time.Now()
	engine := &Engine{pushLast: make(map[string]time.Time, pushDebounceLimit)}
	for index := 0; index < pushDebounceLimit; index++ {
		engine.pushLast[fmt.Sprintf("key-%04d", index)] = now.Add(time.Duration(index) * time.Nanosecond)
	}
	if !engine.admitPushLocked("new-key", now.Add(time.Second)) {
		t.Fatal("new key was not admitted at capacity")
	}
	if len(engine.pushLast) != pushDebounceLimit {
		t.Fatalf("debounce cache length=%d want %d", len(engine.pushLast), pushDebounceLimit)
	}
	if _, ok := engine.pushLast["key-0000"]; ok {
		t.Fatal("oldest debounce entry was not evicted")
	}
	if _, ok := engine.pushLast["new-key"]; !ok {
		t.Fatal("new debounce entry is missing")
	}
}
