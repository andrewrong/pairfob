package main

import (
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"pairfob/internal/runtime"
	"pairfob/internal/state"
	"pairfob/internal/tailnet"
)

type health struct {
	Version        string
	RunningVersion string
	RunningPID     int
	ProcessNote    string
	Running        bool
	Phones         int
	HerdrOK        bool
	HerdrNote      string
	TailnetOK      bool
	Tailnet        string
	TailnetNote    string
}

func doctorCommand(sock string) error {
	h, err := gatherHealth(sock)
	if err != nil {
		return err
	}
	writeDoctor(os.Stdout, h)
	if !h.Running || !h.HerdrOK || !h.TailnetOK {
		return errDoctor
	}
	return nil
}

var errDoctor = fmt.Errorf("not ready")

func gatherHealth(sock string) (health, error) {
	h := health{Version: version, Running: daemonIsLive(sock)}
	store, err := state.Open("")
	if err != nil {
		return h, err
	}
	rows, err := store.LoadDevices()
	if err != nil {
		return h, err
	}
	for _, d := range rows {
		if d.RevokedAt == nil {
			h.Phones++
		}
	}
	if h.Running {
		if p, err := inspectLocalProcess(sock); err == nil {
			h.RunningPID = p.peer.PID
			if p.legacy {
				h.ProcessNote = "legacy interface; actual version unknown"
			} else {
				h.RunningVersion = p.info.Version
				if h.Version != p.info.Version {
					h.ProcessNote = "installed and running programs differ; run pairfob service restart"
				}
				if exe, err := resolvedExecutable(); err == nil {
					if hash, err := executableHash(exe); err == nil && hash != p.info.SHA256 {
						h.ProcessNote = "installed and running programs differ; run pairfob service restart"
					}
				}
			}
			p.peer.Close()
		} else {
			h.ProcessNote = "could not verify the running version"
		}
		if live, liveErr := loadPhones(sock); liveErr == nil {
			h.Phones = len(live)
		}
	}
	rt, _, rtErr := runtime.Open(false, getenv("PAIRFOB_MULTI_SESSION", "") == "1")
	h.HerdrNote = "unavailable — check the configured Herdr socket"
	if rtErr == nil {
		check := checkHerdrInstallation(rt.(*runtime.Herdr))
		h.HerdrOK = check.State == "ready"
		h.HerdrNote = herdrInstallationNote(check)
	}
	endpoint, endpointErr := tailnet.Endpoint(nil)
	if configured := getenv("PAIRFOB_ORIGIN", ""); endpointErr == nil && configured != "" && configured != endpoint {
		endpointErr = fmt.Errorf("configured origin does not match this Tailscale address")
	}
	if endpointErr == nil && h.Running {
		u, _ := url.Parse(endpoint)
		conn, dialErr := net.DialTimeout("tcp", u.Host, time.Second)
		if dialErr != nil {
			endpointErr = fmt.Errorf("Pairfob is not listening on the Tailscale address: %w", dialErr)
		} else {
			_ = conn.Close()
		}
	}
	if endpointErr != nil {
		h.TailnetNote = endpointErr.Error()
	} else {
		h.TailnetOK = true
		h.Tailnet = originHost(endpoint)
	}
	return h, nil
}

func writeDoctor(w io.Writer, h health) {
	fmt.Fprintf(w, "Pairfob %s\n\n", h.Version)
	fmt.Fprintf(w, "  Installed   %s\n", h.Version)
	if h.Running {
		running := h.RunningVersion
		if running == "" {
			running = "unknown"
		}
		fmt.Fprintf(w, "  Process     %s", running)
		if h.RunningPID > 0 {
			fmt.Fprintf(w, " (PID %d)", h.RunningPID)
		}
		fmt.Fprintln(w)
		if h.ProcessNote != "" {
			fmt.Fprintf(w, "  Notice      %s\n", h.ProcessNote)
		}
	}
	fmt.Fprintf(w, "  Running     %s\n", yesNo(h.Running, "yes", "no — it starts at login after install"))
	fmt.Fprintf(w, "  Paired      %d\n", h.Phones)
	fmt.Fprintf(w, "  Herdr       %s\n", h.HerdrNote)
	if h.TailnetOK {
		fmt.Fprintf(w, "  Tailscale   %s\n", h.Tailnet)
	} else {
		fmt.Fprintf(w, "  Tailscale   unavailable (%s)\n", doctorTailnetNote(h.TailnetNote))
	}
	if h.Running {
		fmt.Fprintln(w, "\n  pairfob pair     pair a device")
		fmt.Fprintln(w, "  pairfob list     what's paired")
	} else {
		fmt.Fprintln(w, "\nStart it in this terminal with: pairfob")
	}
}

func doctorTailnetNote(note string) string {
	if note == "" {
		return "start Tailscale and join your tailnet"
	}
	return "start Tailscale and join your tailnet"
}

func writeLiveSnapshot(w io.Writer, sock string) error {
	h, err := gatherHealth(sock)
	if err != nil {
		return err
	}
	fmt.Fprintln(w, "Pairfob is running.")
	switch h.Phones {
	case 0:
		fmt.Fprintln(w, "Nothing paired yet.")
	case 1:
		fmt.Fprintln(w, "1 device paired.")
	default:
		fmt.Fprintf(w, "%d devices paired.\n", h.Phones)
	}
	if h.HerdrOK {
		fmt.Fprintln(w, "Herdr is on.")
	} else {
		fmt.Fprintln(w, "Herdr: "+h.HerdrNote)
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "  pairfob pair     pair a device")
	fmt.Fprintln(w, "  pairfob list     what's paired")
	fmt.Fprintln(w, "  pairfob doctor   full check")
	return nil
}

func yesNo(ok bool, yes, no string) string {
	if ok {
		return yes
	}
	return no
}

func originHost(origin string) string {
	origin = strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://")
	return strings.TrimRight(origin, "/")
}
