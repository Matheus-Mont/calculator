package httpapi

// These tests are internal to the package: the middleware and error helpers are
// unexported, and the failure modes they cover (a panicking handler, an
// unmarshallable payload) cannot be reached through the public router.

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

func TestRecoverPanic(t *testing.T) {
	t.Parallel()

	t.Run("turns a panicking handler into a JSON 500", func(t *testing.T) {
		t.Parallel()

		panicking := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic("boom")
		})

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)

		// The middleware must absorb the panic rather than let it unwind.
		recoverPanic(discardLogger(), panicking).ServeHTTP(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
		}

		// A bare panic would leave the client with an empty reply that is
		// indistinguishable from a network failure; assert real JSON instead.
		var body errorResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("response is not valid JSON: %v\nbody: %s", err, rec.Body.String())
		}
		if body.Error.Code != CodeInternalError {
			t.Errorf("error code = %q, want %q", body.Error.Code, CodeInternalError)
		}
	})

	t.Run("leaves a healthy handler untouched", func(t *testing.T) {
		t.Parallel()

		ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		})

		rec := httptest.NewRecorder()
		recoverPanic(discardLogger(), ok).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

		if rec.Code != http.StatusTeapot {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
		}
	})
}

func TestLogRequests(t *testing.T) {
	t.Parallel()

	t.Run("records the status a handler set", func(t *testing.T) {
		t.Parallel()

		var buf bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&buf, nil))

		handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		})
		rec := httptest.NewRecorder()
		logRequests(logger, handler).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/some/path", nil))

		logged := buf.String()
		for _, want := range []string{`"status":404`, `"method":"POST"`, `"path":"/some/path"`} {
			if !strings.Contains(logged, want) {
				t.Errorf("log line missing %s\ngot: %s", want, logged)
			}
		}
	})

	// A handler that writes a body without calling WriteHeader implicitly
	// returns 200; the recorder has to infer that rather than log a zero.
	t.Run("infers 200 when the handler only writes a body", func(t *testing.T) {
		t.Parallel()

		var buf bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&buf, nil))

		handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			if _, err := w.Write([]byte("hello")); err != nil {
				t.Errorf("write failed: %v", err)
			}
		})
		rec := httptest.NewRecorder()
		logRequests(logger, handler).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

		if !strings.Contains(buf.String(), `"status":200`) {
			t.Errorf("expected an inferred 200 status, got: %s", buf.String())
		}
	})

	// A handler that writes nothing at all also means 200.
	t.Run("infers 200 when the handler writes nothing", func(t *testing.T) {
		t.Parallel()

		var buf bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&buf, nil))

		handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
		rec := httptest.NewRecorder()
		logRequests(logger, handler).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

		if !strings.Contains(buf.String(), `"status":200`) {
			t.Errorf("expected an inferred 200 status, got: %s", buf.String())
		}
	})
}

func TestOriginAllowed(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		allowed string
		origin  string
		want    bool
	}{
		{"exact match", "http://localhost:5173", "http://localhost:5173", true},
		{"different port", "http://localhost:5173", "http://localhost:3000", false},
		{"different scheme", "https://app.example.com", "http://app.example.com", false},
		{"wildcard accepts anything", "*", "http://anywhere.example.com", true},
		{"empty allowlist blocks", "", "http://localhost:5173", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got := originAllowed(tc.allowed, tc.origin); got != tc.want {
				t.Errorf("originAllowed(%q, %q) = %v, want %v", tc.allowed, tc.origin, got, tc.want)
			}
		})
	}
}

// unmarshallable forces json.Marshal to fail, which is the only way to reach
// writeJSON's encoding-failure branch.
type unmarshallable struct{}

func (unmarshallable) MarshalJSON() ([]byte, error) { return nil, errors.New("nope") }

func TestWriteJSONHandlesEncodingFailure(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	writeJSON(rec, discardLogger(), http.StatusOK, unmarshallable{})

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	// Encoding into a buffer first means the failure produces a clean 500
	// rather than a truncated body appended to an already-sent 200.
	if !strings.Contains(rec.Body.String(), string(CodeInternalError)) {
		t.Errorf("body should report an internal error, got: %s", rec.Body.String())
	}
}

func TestFromDomainErrorFallsBackToInternalError(t *testing.T) {
	t.Parallel()

	// An error the mapping does not recognise is a bug in this service, so it
	// must not leak as a 4xx that blames the client.
	apiErr := fromDomainError(errors.New("something unexpected"))

	if apiErr.status != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", apiErr.status, http.StatusInternalServerError)
	}
	if apiErr.detail.Code != CodeInternalError {
		t.Errorf("code = %q, want %q", apiErr.detail.Code, CodeInternalError)
	}
	// The internal detail must not reach the client.
	if strings.Contains(apiErr.Error(), "something unexpected") {
		t.Errorf("internal error detail leaked to the client: %q", apiErr.Error())
	}
}

func TestAPIErrorImplementsError(t *testing.T) {
	t.Parallel()

	var err error = newAPIError(http.StatusBadRequest, CodeInvalidJSON, "bad json")
	if err.Error() != "bad json" {
		t.Errorf("Error() = %q, want %q", err.Error(), "bad json")
	}
}
