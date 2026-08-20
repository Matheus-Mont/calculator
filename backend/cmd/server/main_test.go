package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnvOrDefault(t *testing.T) {
	t.Run("falls back when the variable is unset", func(t *testing.T) {
		if got := envOrDefault("CALCULATOR_TEST_UNSET_VAR", "8080"); got != "8080" {
			t.Errorf("envOrDefault() = %q, want %q", got, "8080")
		}
	})

	t.Run("uses the variable when it is set", func(t *testing.T) {
		t.Setenv("CALCULATOR_TEST_PORT", "9090")

		if got := envOrDefault("CALCULATOR_TEST_PORT", "8080"); got != "9090" {
			t.Errorf("envOrDefault() = %q, want %q", got, "9090")
		}
	})

	// An empty value is treated as unset, so `PORT=` in a compose file does not
	// leave the server trying to listen on no port at all.
	t.Run("treats an empty variable as unset", func(t *testing.T) {
		t.Setenv("CALCULATOR_TEST_PORT", "")

		if got := envOrDefault("CALCULATOR_TEST_PORT", "8080"); got != "8080" {
			t.Errorf("envOrDefault() = %q, want %q", got, "8080")
		}
	})
}

// probeHealth backs the container health check: the runtime image is built FROM
// scratch and has no shell or curl to probe with, so these cases are what keep
// Docker's view of the service honest.
func TestProbeHealth(t *testing.T) {
	t.Run("succeeds against a healthy server", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		if err := probeHealth(portOf(t, srv)); err != nil {
			t.Errorf("probeHealth() returned error for a healthy server: %v", err)
		}
	})

	t.Run("fails on a non-200 response", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer srv.Close()

		if err := probeHealth(portOf(t, srv)); err == nil {
			t.Error("probeHealth() returned nil for a 503; the container would be reported healthy")
		}
	})

	t.Run("fails when nothing is listening", func(t *testing.T) {
		// Bind a port and release it, so the number is almost certainly free.
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("could not reserve a port: %v", err)
		}
		port := portFromAddr(t, listener.Addr().String())
		if err := listener.Close(); err != nil {
			t.Fatalf("could not release the port: %v", err)
		}

		if err := probeHealth(port); err == nil {
			t.Error("probeHealth() returned nil with no server listening")
		}
	})
}

func portOf(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	// httptest URLs look like http://127.0.0.1:41234
	return portFromAddr(t, srv.Listener.Addr().String())
}

func portFromAddr(t *testing.T, addr string) string {
	t.Helper()

	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("could not parse address %q: %v", addr, err)
	}
	return port
}
