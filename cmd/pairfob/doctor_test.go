package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestWriteDoctorIsHuman(t *testing.T) {
	var buf bytes.Buffer
	writeDoctor(&buf, health{
		Version: "dev", Running: true, Phones: 2, HerdrOK: true, HerdrNote: "on", TailnetOK: true, Tailnet: "desk.example.ts.net",
	})
	got := buf.String()
	if strings.Contains(got, "{") || strings.Contains(got, "daemon_id") {
		t.Fatalf("doctor leaked internals: %s", got)
	}
	if !strings.Contains(got, "Running") || !strings.Contains(got, "Paired") || !strings.Contains(got, "Herdr") || !strings.Contains(got, "Tailscale") {
		t.Fatalf("doctor missing checklist: %s", got)
	}
	if !strings.Contains(got, "desk.example.ts.net") {
		t.Fatalf("doctor missing tailnet endpoint: %s", got)
	}
}

func TestWriteDoctorSanitizesTailnetNote(t *testing.T) {
	var buf bytes.Buffer
	writeDoctor(&buf, health{
		Version: "dev", TailnetNote: `daemon_id=d_abc {"reconnect_token":"rt_x"}`,
	})
	got := buf.String()
	assertOperatorText(t, got)
	if strings.Contains(got, "daemon_id") || strings.Contains(got, "reconnect_token") || strings.Contains(got, "{") {
		t.Fatalf("doctor leaked internals: %s", got)
	}
	if !strings.Contains(got, "Tailscale") || !strings.Contains(got, "start Tailscale") {
		t.Fatalf("doctor missing sanitized tailnet note: %s", got)
	}
}

func TestWriteLiveSnapshot(t *testing.T) {
	var buf bytes.Buffer
	writeDoctor(&buf, health{Version: "dev", Running: false, HerdrNote: "off — open Herdr on this computer"})
	if !strings.Contains(buf.String(), "no —") {
		t.Fatalf("%s", buf.String())
	}
}

func TestDoctorDistinguishesInstalledAndRunningVersions(t *testing.T) {
	var out bytes.Buffer
	writeDoctor(&out, health{Version: "v1.1.0", Running: true, RunningVersion: "0027625", RunningPID: 42, ProcessNote: "installed and running programs differ"})
	for _, want := range []string{"Installed   v1.1.0", "Process     0027625 (PID 42)", "programs differ"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("missing %q in %s", want, out.String())
		}
	}
}
