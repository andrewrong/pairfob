package tailnet

import (
	"io"
	"net"
	"net/http"
	"testing"
)

func TestHealthBodyMatchesGateway(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	g := New(ln, "http://"+ln.Addr().String())
	defer g.Close()
	go g.Serve()
	resp, err := http.Get("http://" + ln.Addr().String() + "/v2/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(body) != HealthBody {
		t.Fatalf("%d %q", resp.StatusCode, body)
	}
}
