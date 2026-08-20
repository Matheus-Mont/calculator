package httpapi

import (
	"log/slog"
	"net/http"
	"time"
)

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
					slog.Any("panic", recovered),
					slog.String("path", r.URL.Path),
				)
				writeError(w, logger, newAPIError(
					http.StatusInternalServerError, CodeInternalError,
					"an unexpected error occurred",
				))
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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
