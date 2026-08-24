package httpapi_test

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Matheus-Mont/calculator/backend/internal/httpapi"
)

const testOrigin = "http://localhost:5173"

// newTestRouter builds the real router with logging discarded, so tests
// exercise the same middleware stack that production uses.
func newTestRouter() http.Handler {
	return httpapi.NewRouter(slog.New(slog.DiscardHandler), testOrigin)
}

// do issues a request against the full router and returns the recorder.
func do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()

	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}

	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, req)
	return rec
}

// decodeBody unmarshals a response body, failing the test on malformed JSON.
// Every response this API produces must be valid JSON, so this doubles as an
// assertion.
func decodeBody[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()

	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response body is not valid JSON: %v\nbody: %s", err, rec.Body.String())
	}
	return out
}

type calcResult struct {
	Operation string `json:"operation"`
	Operands  struct {
		A float64  `json:"a"`
		B *float64 `json:"b"`
	} `json:"operands"`
	Result float64 `json:"result"`
}

type errBody struct {
	Error struct {
		Code                string   `json:"code"`
		Message             string   `json:"message"`
		SupportedOperations []string `json:"supported_operations"`
	} `json:"error"`
}

func assertStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d\nbody: %s", rec.Code, want, rec.Body.String())
	}
}

func assertErrorCode(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()

	assertStatus(t, rec, wantStatus)
	body := decodeBody[errBody](t, rec)
	if body.Error.Code != wantCode {
		t.Errorf("error code = %q, want %q\nbody: %s", body.Error.Code, wantCode, rec.Body.String())
	}
	if body.Error.Message == "" {
		t.Error("error message is empty; every failure should explain itself")
	}
}

func TestCalculateSuccess(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		op   string
		body string
		want float64
	}{
		{"add", "add", `{"a":2,"b":3}`, 5},
		{"subtract", "subtract", `{"a":10,"b":4}`, 6},
		{"multiply", "multiply", `{"a":6,"b":7}`, 42},
		{"divide", "divide", `{"a":10,"b":4}`, 2.5},
		{"power", "power", `{"a":2,"b":10}`, 1024},
		{"percentage", "percentage", `{"a":20,"b":50}`, 10},
		{"sqrt", "sqrt", `{"a":81}`, 9},
		{"negative operands", "add", `{"a":-5,"b":-7}`, -12},
		{"decimal operands", "multiply", `{"a":2.5,"b":4}`, 10},
		{"explicit zero operand", "add", `{"a":0,"b":0}`, 0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			rec := do(t, http.MethodPost, "/api/v1/operations/"+tc.op, tc.body)
			assertStatus(t, rec, http.StatusOK)

			if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}

			got := decodeBody[calcResult](t, rec)
			if got.Result != tc.want {
				t.Errorf("result = %v, want %v", got.Result, tc.want)
			}
			if got.Operation != tc.op {
				t.Errorf("operation = %q, want %q", got.Operation, tc.op)
			}
		})
	}
}

// TestCalculateEchoesOperands documents that the response is self-describing,
// which is what lets the frontend render history entries without tracking the
// request it sent.
func TestCalculateEchoesOperands(t *testing.T) {
	t.Parallel()

	t.Run("binary operation includes both operands", func(t *testing.T) {
		t.Parallel()

		rec := do(t, http.MethodPost, "/api/v1/operations/divide", `{"a":10,"b":4}`)
		assertStatus(t, rec, http.StatusOK)

		got := decodeBody[calcResult](t, rec)
		if got.Operands.A != 10 {
			t.Errorf("operands.a = %v, want 10", got.Operands.A)
		}
		if got.Operands.B == nil || *got.Operands.B != 4 {
			t.Errorf("operands.b = %v, want 4", got.Operands.B)
		}
	})

	t.Run("unary operation omits the second operand", func(t *testing.T) {
		t.Parallel()

		rec := do(t, http.MethodPost, "/api/v1/operations/sqrt", `{"a":81}`)
		assertStatus(t, rec, http.StatusOK)

		if strings.Contains(rec.Body.String(), `"b"`) {
			t.Errorf("sqrt response should omit operand b, got: %s", rec.Body.String())
		}
	})
}

func TestCalculateDomainErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		op         string
		body       string
		wantStatus int
		wantCode   string
	}{
		{"division by zero", "divide", `{"a":10,"b":0}`, http.StatusBadRequest, "division_by_zero"},
		{"zero divided by zero", "divide", `{"a":0,"b":0}`, http.StatusBadRequest, "division_by_zero"},
		{"square root of negative", "sqrt", `{"a":-9}`, http.StatusBadRequest, "negative_square_root"},

		// Overflow is a 422: the request was valid, the result simply cannot
		// be represented as a finite float64 (nor encoded as JSON).
		{"multiplication overflow", "multiply", `{"a":1.7976931348623157e308,"b":10}`,
			http.StatusUnprocessableEntity, "result_not_finite"},
		{"power overflow", "power", `{"a":10,"b":400}`,
			http.StatusUnprocessableEntity, "result_not_finite"},
		{"zero to a negative power", "power", `{"a":0,"b":-1}`,
			http.StatusUnprocessableEntity, "result_not_finite"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			rec := do(t, http.MethodPost, "/api/v1/operations/"+tc.op, tc.body)
			assertErrorCode(t, rec, tc.wantStatus, tc.wantCode)
		})
	}
}

func TestCalculateRejectsInvalidOperands(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		op   string
		body string
	}{
		{"missing operand a", "add", `{"b":3}`},
		{"missing operand b on binary operation", "divide", `{"a":10}`},
		{"both operands missing", "add", `{}`},
		{"null operand", "add", `{"a":null,"b":3}`},
		// Supplying b to a unary operation is rejected rather than ignored:
		// silently dropping it would hide a client bug.
		{"second operand on unary operation", "sqrt", `{"a":16,"b":2}`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			rec := do(t, http.MethodPost, "/api/v1/operations/"+tc.op, tc.body)
			assertErrorCode(t, rec, http.StatusBadRequest, "invalid_operands")
		})
	}
}

// TestMissingOperandIsNotTreatedAsZero is the reason the request DTO uses
// pointers. If it did not, {"a":10} on a divide would compute 10/0.
func TestMissingOperandIsNotTreatedAsZero(t *testing.T) {
	t.Parallel()

	rec := do(t, http.MethodPost, "/api/v1/operations/divide", `{"a":10}`)
	assertErrorCode(t, rec, http.StatusBadRequest, "invalid_operands")

	body := decodeBody[errBody](t, rec)
	if body.Error.Code == "division_by_zero" {
		t.Error("a missing operand was silently coerced to zero")
	}
}

func TestCalculateRejectsMalformedBodies(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		body     string
		wantCode string
	}{
		{"malformed json", `{"a":1,`, "invalid_json"},
		{"not an object", `"hello"`, "invalid_operands"},
		{"empty body", ``, "invalid_json"},
		{"unknown field", `{"a":1,"b":2,"c":3}`, "invalid_json"},
		{"trailing content after object", `{"a":1,"b":2}{"a":3}`, "invalid_json"},
		{"operand is a string", `{"a":"one","b":2}`, "invalid_operands"},
		{"operand is a boolean", `{"a":true,"b":2}`, "invalid_operands"},
		// 1e400 does not fit in a float64, so decoding fails before any
		// arithmetic is attempted.
		{"operand overflows float64", `{"a":1e400,"b":2}`, "invalid_operands"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			rec := do(t, http.MethodPost, "/api/v1/operations/add", tc.body)
			assertErrorCode(t, rec, http.StatusBadRequest, tc.wantCode)
		})
	}
}

func TestCalculateRejectsOversizedBody(t *testing.T) {
	t.Parallel()

	// Comfortably past the 1 MiB cap.
	oversized := `{"a":1,"b":` + strings.Repeat("9", 2<<20) + `}`

	rec := do(t, http.MethodPost, "/api/v1/operations/add", oversized)
	assertErrorCode(t, rec, http.StatusRequestEntityTooLarge, "request_too_large")
}

func TestUnsupportedOperation(t *testing.T) {
	t.Parallel()

	rec := do(t, http.MethodPost, "/api/v1/operations/modulo", `{"a":10,"b":3}`)
	assertErrorCode(t, rec, http.StatusNotFound, "unsupported_operation")

	// The error lists the valid set so it is self-documenting.
	body := decodeBody[errBody](t, rec)
	if len(body.Error.SupportedOperations) != 7 {
		t.Errorf("supported_operations has %d entries, want 7: %v",
			len(body.Error.SupportedOperations), body.Error.SupportedOperations)
	}
}

// TestUnsupportedOperationIsCheckedBeforeBody documents the ordering: an
// unknown operation is a 404 even when the body is also invalid.
func TestUnsupportedOperationIsCheckedBeforeBody(t *testing.T) {
	t.Parallel()

	rec := do(t, http.MethodPost, "/api/v1/operations/modulo", `{"garbage`)
	assertErrorCode(t, rec, http.StatusNotFound, "unsupported_operation")
}

func TestMethodNotAllowed(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		method    string
		path      string
		wantAllow string
	}{
		{"get on calculate endpoint", http.MethodGet, "/api/v1/operations/add", "POST, OPTIONS"},
		{"delete on calculate endpoint", http.MethodDelete, "/api/v1/operations/add", "POST, OPTIONS"},
		{"post on operations list", http.MethodPost, "/api/v1/operations", "GET, OPTIONS"},
		{"post on healthz", http.MethodPost, "/healthz", "GET, OPTIONS"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			rec := do(t, tc.method, tc.path, "")
			assertErrorCode(t, rec, http.StatusMethodNotAllowed, "method_not_allowed")

			if allow := rec.Header().Get("Allow"); allow != tc.wantAllow {
				t.Errorf("Allow header = %q, want %q", allow, tc.wantAllow)
			}
		})
	}
}

func TestUnknownPathReturnsJSON(t *testing.T) {
	t.Parallel()

	rec := do(t, http.MethodGet, "/api/v1/nonsense", "")
	assertErrorCode(t, rec, http.StatusNotFound, "not_found")
}

func TestHealthz(t *testing.T) {
	t.Parallel()

	rec := do(t, http.MethodGet, "/healthz", "")
	assertStatus(t, rec, http.StatusOK)

	body := decodeBody[map[string]string](t, rec)
	if body["status"] != "ok" {
		t.Errorf("status = %q, want %q", body["status"], "ok")
	}
}

func TestListOperations(t *testing.T) {
	t.Parallel()

	rec := do(t, http.MethodGet, "/api/v1/operations", "")
	assertStatus(t, rec, http.StatusOK)

	body := decodeBody[struct {
		Operations []struct {
			Operation   string `json:"operation"`
			Arity       int    `json:"arity"`
			Description string `json:"description"`
		} `json:"operations"`
	}](t, rec)

	if len(body.Operations) != 7 {
		t.Fatalf("listed %d operations, want 7", len(body.Operations))
	}

	for _, op := range body.Operations {
		if op.Description == "" {
			t.Errorf("operation %q has no description", op.Operation)
		}
		if op.Arity != 1 && op.Arity != 2 {
			t.Errorf("operation %q has arity %d, want 1 or 2", op.Operation, op.Arity)
		}
		if op.Operation == "sqrt" && op.Arity != 1 {
			t.Errorf("sqrt arity = %d, want 1", op.Arity)
		}
	}

	// Sorted so the payload is stable across runs.
	if body.Operations[0].Operation != "add" {
		t.Errorf("first operation = %q, want %q (list should be sorted)",
			body.Operations[0].Operation, "add")
	}
}

// TestListOperationsMatchesCalculate guards against the discovery endpoint
// advertising an operation that the compute endpoint cannot actually perform.
func TestListOperationsMatchesCalculate(t *testing.T) {
	t.Parallel()

	rec := do(t, http.MethodGet, "/api/v1/operations", "")
	assertStatus(t, rec, http.StatusOK)

	listed := decodeBody[struct {
		Operations []struct {
			Operation string `json:"operation"`
			Arity     int    `json:"arity"`
		} `json:"operations"`
	}](t, rec)

	for _, op := range listed.Operations {
		body := `{"a":4,"b":2}`
		if op.Arity == 1 {
			body = `{"a":4}`
		}

		got := do(t, http.MethodPost, "/api/v1/operations/"+op.Operation, body)
		if got.Code != http.StatusOK {
			t.Errorf("advertised operation %q failed with status %d: %s",
				op.Operation, got.Code, got.Body.String())
		}
	}
}

func TestCORS(t *testing.T) {
	t.Parallel()

	t.Run("preflight is answered without reaching the handler", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodOptions, "/api/v1/operations/add", nil)
		req.Header.Set("Origin", testOrigin)
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)

		rec := httptest.NewRecorder()
		newTestRouter().ServeHTTP(rec, req)

		assertStatus(t, rec, http.StatusNoContent)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != testOrigin {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, testOrigin)
		}
		if got := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "POST") {
			t.Errorf("Access-Control-Allow-Methods = %q, want it to include POST", got)
		}
	})

	// Error responses must carry CORS headers too, otherwise the browser
	// blocks the body and the UI cannot show why the request failed.
	t.Run("error responses carry CORS headers", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/divide",
			strings.NewReader(`{"a":1,"b":0}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", testOrigin)

		rec := httptest.NewRecorder()
		newTestRouter().ServeHTTP(rec, req)

		assertStatus(t, rec, http.StatusBadRequest)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != testOrigin {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, testOrigin)
		}
	})

	t.Run("disallowed origin is not echoed back", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add",
			strings.NewReader(`{"a":1,"b":2}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://evil.example.com")

		rec := httptest.NewRecorder()
		newTestRouter().ServeHTTP(rec, req)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("Access-Control-Allow-Origin = %q, want it to be absent", got)
		}
	})

	t.Run("vary on origin is always set", func(t *testing.T) {
		t.Parallel()

		rec := do(t, http.MethodGet, "/healthz", "")
		if got := rec.Header().Get("Vary"); got != "Origin" {
			t.Errorf("Vary = %q, want %q", got, "Origin")
		}
	})
}

func TestContentTypeIsRequired(t *testing.T) {
	t.Parallel()

	// Guessing at an unlabelled body is how a client sends the wrong thing for
	// a long time without noticing, so the header is mandatory.
	tests := []struct {
		name        string
		contentType string
		wantStatus  int
	}{
		{"json is accepted", "application/json", http.StatusOK},
		{"json with charset is accepted", "application/json; charset=utf-8", http.StatusOK},
		{"missing is rejected", "", http.StatusUnsupportedMediaType},
		{"form encoding is rejected", "application/x-www-form-urlencoded", http.StatusUnsupportedMediaType},
		{"plain text is rejected", "text/plain", http.StatusUnsupportedMediaType},
		{"malformed header is rejected", "application/json;;;", http.StatusUnsupportedMediaType},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add",
				strings.NewReader(`{"a":1,"b":2}`))
			if tc.contentType != "" {
				req.Header.Set("Content-Type", tc.contentType)
			}

			rec := httptest.NewRecorder()
			newTestRouter().ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d\nbody: %s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantStatus == http.StatusUnsupportedMediaType {
				body := decodeBody[errBody](t, rec)
				if body.Error.Code != "unsupported_media_type" {
					t.Errorf("error code = %q, want %q", body.Error.Code, "unsupported_media_type")
				}
			}
		})
	}
}

// The request id is what lets someone reporting a failure — at 3am, from a
// support ticket — be found in the logs.
func TestRequestID(t *testing.T) {
	t.Parallel()

	t.Run("is generated when the caller supplies none", func(t *testing.T) {
		t.Parallel()

		rec := do(t, http.MethodGet, "/healthz", "")

		id := rec.Header().Get("X-Request-Id")
		if id == "" {
			t.Fatal("X-Request-Id header is missing")
		}
		if len(id) < 8 {
			t.Errorf("X-Request-Id = %q, want something long enough to be unique", id)
		}
	})

	t.Run("differs between requests", func(t *testing.T) {
		t.Parallel()

		first := do(t, http.MethodGet, "/healthz", "").Header().Get("X-Request-Id")
		second := do(t, http.MethodGet, "/healthz", "").Header().Get("X-Request-Id")

		if first == second {
			t.Errorf("two requests shared the id %q", first)
		}
	})

	// Reusing an upstream id is what keeps a trace intact across a proxy.
	t.Run("reuses an id supplied upstream", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.Header.Set("X-Request-Id", "edge-proxy-abc123")

		rec := httptest.NewRecorder()
		newTestRouter().ServeHTTP(rec, req)

		if got := rec.Header().Get("X-Request-Id"); got != "edge-proxy-abc123" {
			t.Errorf("X-Request-Id = %q, want the upstream value", got)
		}
	})

	// A caller must not be able to inject newlines and forge log entries, or to
	// pad every line with an unbounded string.
	t.Run("replaces a hostile id", func(t *testing.T) {
		t.Parallel()

		for _, hostile := range []string{
			"forged\nlevel=ERROR msg=\"fake entry\"",
			strings.Repeat("x", 500),
			"has spaces",
		} {
			req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
			req.Header.Set("X-Request-Id", hostile)

			rec := httptest.NewRecorder()
			newTestRouter().ServeHTTP(rec, req)

			got := rec.Header().Get("X-Request-Id")
			if got == hostile {
				t.Errorf("hostile id %q was echoed back unchanged", hostile[:min(len(hostile), 30)])
			}
			if got == "" {
				t.Error("no id was generated to replace the rejected one")
			}
		}
	})

	t.Run("appears in error bodies", func(t *testing.T) {
		t.Parallel()

		rec := do(t, http.MethodPost, "/api/v1/operations/divide", `{"a":1,"b":0}`)
		assertStatus(t, rec, http.StatusBadRequest)

		body := decodeBody[struct {
			Error struct {
				RequestID string `json:"request_id"`
			} `json:"error"`
		}](t, rec)

		if body.Error.RequestID == "" {
			t.Fatal("error body carries no request_id")
		}
		// The body and the header must agree, or quoting one would not find the other.
		if body.Error.RequestID != rec.Header().Get("X-Request-Id") {
			t.Errorf("body request_id %q does not match header %q",
				body.Error.RequestID, rec.Header().Get("X-Request-Id"))
		}
	})
}
