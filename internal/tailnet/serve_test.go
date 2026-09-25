package tailnet

import (
	"strings"
	"testing"
)

type recordedCall struct {
	name string
	args []string
}

type fakeRunner struct {
	responses map[string][]byte
	err       map[string]error
	calls     []recordedCall
}

func (r *fakeRunner) Run(name string, args ...string) ([]byte, error) {
	key := name + " " + strings.Join(args, " ")
	r.calls = append(r.calls, recordedCall{name: name, args: append([]string(nil), args...)})
	if err := r.err[key]; err != nil {
		return nil, err
	}
	return r.responses[key], nil
}

func TestEndpointUsesTailscaleIPv4(t *testing.T) {
	runner := &fakeRunner{responses: map[string][]byte{
		"tailscale status --json": []byte(`{"BackendState":"Running","Self":{"Online":true,"TailscaleIPs":["fd7a:115c:a1e0::1","100.64.1.2"]}}`),
	}}
	got, err := Endpoint(runner)
	if err != nil || got != "http://100.64.1.2:18474" {
		t.Fatalf("Endpoint() = %q, %v", got, err)
	}
}

func TestEndpointRejectsOfflineOrNonMagicDNS(t *testing.T) {
	for _, status := range []string{
		`{"BackendState":"Stopped","Self":{"DNSName":"desk.example.ts.net","Online":true}}`,
		`{"BackendState":"Running","Self":{"DNSName":"desk.example.ts.net","Online":false}}`,
		`{"BackendState":"Running","Self":{"DNSName":"desk.example.test","Online":true}}`,
	} {
		runner := &fakeRunner{responses: map[string][]byte{"tailscale status --json": []byte(status)}}
		if _, err := Endpoint(runner); err == nil {
			t.Fatalf("Endpoint accepted %s", status)
		}
	}
}
