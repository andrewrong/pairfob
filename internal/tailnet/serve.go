package tailnet

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os/exec"
	"strings"
)

// CommandRunner is the narrow seam around the Tailscale CLI.
type CommandRunner interface {
	Run(name string, args ...string) ([]byte, error)
}

type execRunner struct{}

func (execRunner) Run(name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

type Status struct {
	BackendState string `json:"BackendState"`
	Self         struct {
		Online       bool     `json:"Online"`
		TailscaleIPs []string `json:"TailscaleIPs"`
	} `json:"Self"`
}

// Endpoint discovers the direct Tailscale IPv4 endpoint. The phone connects
// through the existing tailnet; Pairfob neither configures nor needs Serve.
func Endpoint(runner CommandRunner) (string, error) {
	if runner == nil {
		runner = execRunner{}
	}
	out, err := runner.Run("tailscale", "status", "--json")
	if err != nil {
		return "", fmt.Errorf("tailscale status: %w", err)
	}
	var status Status
	if err := json.Unmarshal(out, &status); err != nil {
		return "", fmt.Errorf("tailscale status JSON: %w", err)
	}
	if status.BackendState != "Running" || !status.Self.Online {
		return "", errors.New("tailscale is not online")
	}
	for _, raw := range status.Self.TailscaleIPs {
		ip := net.ParseIP(raw)
		if ip != nil && ip.To4() != nil {
			return "http://" + ip.String() + ":18474", nil
		}
	}
	return "", errors.New("tailscale has no IPv4 address")
}
