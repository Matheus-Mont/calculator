package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"
)

// RequestIDHeader carries the correlation id, both inbound and outbound.
const RequestIDHeader = "X-Request-Id"

// maxInboundRequestIDLen bounds an id supplied by a caller, so a hostile client
// cannot pad log lines with an unbounded string.
const maxInboundRequestIDLen = 64

// contextKey is unexported so no other package can collide with these keys.
type contextKey struct{ name string }

var requestIDKey = &contextKey{"request-id"}

// withRequestID tags every request with a correlation id, reusing one supplied
// by an upstream proxy or load balancer when present so a trace survives the
// hop. The id goes into every log line for the request, comes back on the
// response header, and is included in error bodies — which is what lets someone
// reporting a failure quote something findable in the logs.
func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := sanitiseRequestID(r.Header.Get(RequestIDHeader))
		if id == "" {
			id = newRequestID()
		}

		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

// requestIDFrom returns the correlation id carried by ctx, if any.
func requestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// sanitiseRequestID accepts only printable ASCII, so a caller cannot inject
// newlines into the log stream and forge entries.
func sanitiseRequestID(raw string) string {
	if len(raw) == 0 || len(raw) > maxInboundRequestIDLen {
		return ""
	}
	for _, r := range raw {
		if r < '!' || r > '~' {
			return ""
		}
	}
	return raw
}

// newRequestID returns a random hex id. crypto/rand keeps this dependency-free;
// it cannot fail in practice, and a fixed fallback is preferable to refusing the
// request over a missing log label.
func newRequestID() string {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "unidentified"
	}
	return hex.EncodeToString(buf[:])
}

// statusRecorder wraps http.ResponseWriter to remember the status code, which
// the standard interface does not expose but request logging needs.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// Write records an implicit 200 for handlers that write a body without calling
// WriteHeader first.
func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

// logRequests emits one structured line per request. It sits outermost so the
// status it records is the one actually sent, including 500s synthesised by
// recoverPanic.
func logRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}

		next.ServeHTTP(rec, r)

		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		logger.Info("request",
			slog.String("request_id", requestIDFrom(r.Context())),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", rec.status),
			slog.Duration("duration", time.Since(start)),
		)
	})
}

// recoverPanic converts a panic in a handler into a JSON 500 instead of letting
// net/http drop the connection with an empty reply, which a browser client
// cannot distinguish from a network failure.
func recoverPanic(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("panic recovered",
					slog.String("request_id", requestIDFrom(r.Context())),
					slog.Any("panic", recovered),
					slog.String("path", r.URL.Path),
				)
				writeError(w, logger, newAPIError(
					http.StatusInternalServerError, CodeInternalError,
					"an unexpected error occurred",
				), r)
			}
		}()

		next.ServeHTTP(w, r)
	})
}

// withCORS allows the browser frontend to call the API from its own origin.
//
// It wraps the router rather than individual handlers so that error responses
// carry the headers too. Without that, a browser blocks the response body and
// the UI cannot show why a request failed.
func withCORS(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Vary tells caches the response depends on the request Origin.
		w.Header().Set("Vary", "Origin")

		if origin := r.Header.Get("Origin"); origin != "" && originAllowed(allowedOrigin, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, "+RequestIDHeader)
			// Without this the browser hides the header from page scripts, so a
			// client could not report the id of a failed request.
			w.Header().Set("Access-Control-Expose-Headers", RequestIDHeader)
			w.Header().Set("Access-Control-Max-Age", "300")
		}

		// Preflight requests are answered here and never reach the router.
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// originAllowed reports whether origin may call the API. "*" opts into allowing
// any origin, which is acceptable here only because the API is unauthenticated
// and carries no credentials or user data.
func originAllowed(allowed, origin string) bool {
	return allowed == "*" || allowed == origin
}
