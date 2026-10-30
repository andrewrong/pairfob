package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"pairfob/internal/tailnet"
)

func TestValidateHealthAddr(t *testing.T) {
	for _, ok := range []string{"", "127.0.0.1:18475", "[::1]:18475", "127.0.0.1:0"} {
		if err := validateHealthAddr(ok); err != nil {
			t.Errorf("%q refused: %v", ok, err)
		}
	}
	tail := netip.AddrPortFrom(netip.AddrFrom4([4]byte{100, 64, 1, 2}), 18475).String()
	for _, bad := range []string{"0.0.0.0:18475", "[::]:18475", "localhost:18475", "192.168.1.5:18475", "127.0.0.1", "127.0.0.1:", ":18475", tail} {
		err := validateHealthAddr(bad)
		if err == nil || !strings.Contains(err.Error(), "PAIRFOB_HEALTH_ADDR") {
			t.Errorf("%q: want error naming PAIRFOB_HEALTH_ADDR, got %v", bad, err)
		}
	}
}

func TestHealthHandler(t *testing.T) {
	h := healthHandler()
	for _, m := range []string{http.MethodGet, http.MethodHead} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(m, "/v2/health", nil))
		if rec.Code != 200 {
			t.Fatalf("%s: %d", m, rec.Code)
		}
		if rec.Header().Get("Content-Type") != "application/json" || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s headers: %v", m, rec.Header())
		}
		if m == http.MethodGet && rec.Body.String() != tailnet.HealthBody {
			t.Fatalf("body %q", rec.Body.String())
		}
	}
	for _, c := range [][2]string{{"GET", "/v2/ws"}, {"GET", "/"}, {"GET", "/api/config"}, {"POST", "/v2/health"}, {"PUT", "/v2/health"}, {"DELETE", "/v2/health"}} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(c[0], c[1], nil))
		if rec.Code != 404 {
			t.Errorf("%s %s: %d", c[0], c[1], rec.Code)
		}
	}
}

func TestStartHealthLoopback(t *testing.T) {
	c, err := startHealth("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := c.(interface{ Addr() net.Addr }).Addr().String()
	resp, err := http.Get("http://" + addr + "/v2/health")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(body) != tailnet.HealthBody {
		t.Fatalf("%d %q", resp.StatusCode, body)
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	if conn, err := net.Dial("tcp", addr); err == nil {
		conn.Close()
		t.Fatal("connection accepted after Close")
	}
}

func TestStartHealthEmptyIsOff(t *testing.T) {
	c, err := startHealth("")
	if c != nil || err != nil {
		t.Fatalf("got %v, %v", c, err)
	}
}
