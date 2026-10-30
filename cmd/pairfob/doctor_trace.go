package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"pairfob/internal/admin"
)

// exitError carries a process exit status through runCommand. The command has
// already printed whatever the user needs to read, so main only exits.
type exitError struct{ code int }

func (e exitError) Error() string { return fmt.Sprintf("exit status %d", e.code) }

const doctorUsage = "usage: pairfob doctor [--trace]"

func doctorArgs(args []string, sock string) error {
	switch {
	case len(args) == 0:
		return doctorCommand(sock)
	case len(args) == 1 && args[0] == "--trace":
		return doctorTrace(os.Stdout, os.Stderr, sock)
	default:
		return errors.New(doctorUsage)
	}
}

// doctorTrace asks the running daemon, over the admin socket, whether it can
// read the conversation record of each live pane. It prints no message text,
// path or session id; the daemon never sends them.
func doctorTrace(stdout, stderr io.Writer, sock string) error {
	resp, err := admin.Call(sock, admin.Request{Op: "trace.check"})
	if err != nil {
		if errors.Is(err, admin.ErrNotRunning) {
			fmt.Fprintln(stderr, "Pairfob isn't running. It starts at login after install, or run pairfob in a terminal.")
			return exitError{code: 2}
		}
		return err
	}
	var body struct {
		Panes []admin.TracePane `json:"panes"`
	}
	if err := json.Unmarshal(resp.Result, &body); err != nil {
		return errors.New("trace.check returned an unreadable answer")
	}
	bad := 0
	for _, p := range body.Panes {
		fmt.Fprintf(stdout, "%s %s %s\n", p.Pane, p.Agent, p.Result)
		if p.Result != "ok" {
			bad++
		}
	}
	fmt.Fprintf(stdout, "traces: %d ok, %d not ok\n", len(body.Panes)-bad, bad)
	if bad > 0 {
		return exitError{code: 1}
	}
	return nil
}
