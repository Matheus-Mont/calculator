// Command server runs the calculator HTTP API.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Matheus-Mont/calculator/backend/internal/httpapi"
)

const (
	defaultPort          = "8080"
	defaultAllowedOrigin = "http://localhost:5173" // Vite's dev server.

	// shutdownTimeout bounds how long in-flight requests may finish before the
	// process exits anyway.
	shutdownTimeout = 10 * time.Second
)

func main() {
	// The runtime image is built FROM scratch, which has no shell and no curl,
	// so the container health check re-executes this same binary instead.
	healthcheck := flag.Bool("healthcheck", false,
		"probe the local /healthz endpoint and exit non-zero if it is unhealthy")
	flag.Parse()

	if *healthcheck {
		if err := probeHealth(envOrDefault("PORT", defaultPort)); err != nil {
			fmt.Fprintln(os.Stderr, "healthcheck failed:", err)
			os.Exit(1)
		}
		return
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if err := run(logger); err != nil {
		logger.Error("server terminated", slog.Any("error", err))
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	port := envOrDefault("PORT", defaultPort)
	allowedOrigin := envOrDefault("CORS_ALLOWED_ORIGIN", defaultAllowedOrigin)

	srv := &http.Server{
		Addr:    net.JoinHostPort("", port),
		Handler: httpapi.NewRouter(logger, allowedOrigin),

		// Explicit timeouts: without them a slow or idle client can hold a
		// connection open indefinitely.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Signal handling is installed before the listener starts so a Ctrl-C
	// during startup is not lost.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("server listening",
			slog.String("addr", srv.Addr),
			slog.String("cors_allowed_origin", allowedOrigin),
		)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case err := <-serveErr:
		return err

	case <-ctx.Done():
		logger.Info("shutdown signal received, draining connections")

		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		logger.Info("server stopped cleanly")
		return nil
	}
}

// probeHealth requests /healthz on the local server, for the container health
// check. It returns an error unless the server answers 200.
func probeHealth(port string) error {
	client := &http.Client{Timeout: 2 * time.Second}

	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	return nil
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
