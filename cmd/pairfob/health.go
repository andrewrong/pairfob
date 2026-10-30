package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"time"

	"pairfob/internal/tailnet"
)

// validateHealthAddr accepts an empty value (listener off) or a literal
// loopback address with a port.
func validateHealthAddr(addr string) error {
	if addr == "" {
		return nil
	}
	ap, err := netip.ParseAddrPort(addr)
	if err != nil || !ap.Addr().IsLoopback() {
		return fmt.Errorf("PAIRFOB_HEALTH_ADDR %q must be a loopback address with a port, like 127.0.0.1:18475", addr)
	}
	return nil
}

// healthHandler serves one constant on GET and HEAD /v2/health and 404 for
// everything else. It deliberately sets no security headers and checks no
// origin: it exposes no state.
func healthHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/health" || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(tailnet.HealthBody))
		}
	})
}

type healthServer struct {
	srv *http.Server
	ln  net.Listener
}

func (h *healthServer) Addr() net.Addr { return h.ln.Addr() }

func (h *healthServer) Close() error { return h.srv.Close() }

// startHealth opens the optional loopback health listener. It returns a nil
// closer and nil error when addr is empty.
func startHealth(addr string) (io.Closer, error) {
	if addr == "" {
		return nil, nil
	}
	if err := validateHealthAddr(addr); err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("PAIRFOB_HEALTH_ADDR listener: %w", err)
	}
	h := &healthServer{ln: ln, srv: &http.Server{
		Handler:           healthHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}}
	go func() {
		if err := h.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("health listener: %v", err)
		}
	}()
	return h, nil
}
