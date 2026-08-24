// Package httpapi exposes the calculator domain over a JSON REST API.
//
// It owns everything transport-related — routing, decoding, validation of the
// request shape, and the mapping of domain errors onto status codes — and
// knows nothing about how arithmetic is actually performed.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"gitlab.com/mathspa98/calculator/backend/internal/calc"
)

// maxRequestBodyBytes caps request bodies. The largest legitimate request here
// is a few dozen bytes, so 1 MiB is generous while still refusing to buffer an
// unbounded upload.
const maxRequestBodyBytes = 1 << 20

// calculateRequest is the body of POST /api/v1/operations/{operation}.
//
// The operands are pointers so that a missing field can be told apart from an
// explicit zero. Without this, {"a":10} on a divide would silently become
// 10 / 0 instead of the validation error it should be.
type calculateRequest struct {
	A *float64 `json:"a"`
	B *float64 `json:"b"`
}

// calculateResponse echoes the operands back alongside the result, so a
// response is self-describing in logs and in the frontend history.
type calculateResponse struct {
	Operation calc.Operation `json:"operation"`
	Operands  operands       `json:"operands"`
	Result    float64        `json:"result"`
}

type operands struct {
	A float64 `json:"a"`
	// B is omitted entirely for unary operations such as sqrt.
	B *float64 `json:"b,omitempty"`
}

// operationResponse describes one supported operation in GET /api/v1/operations.
type operationResponse struct {
	Operation   calc.Operation `json:"operation"`
	Arity       int            `json:"arity"`
	Description string         `json:"description"`
}

type server struct {
	logger *slog.Logger
}

// NewRouter builds the fully wired HTTP handler, middleware included.
func NewRouter(logger *slog.Logger, allowedOrigin string) http.Handler {
	s := &server{logger: logger}

	mux := http.NewServeMux()

	// Go 1.22+ patterns carry the method, and the more specific pattern wins.
	// Registering the method-less twin of each route lets a wrong method
	// produce a JSON 405 instead of net/http's plain-text default.
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("/healthz", s.methodNotAllowed(http.MethodGet))

	mux.HandleFunc("GET /api/v1/operations", s.handleListOperations)
	mux.HandleFunc("/api/v1/operations", s.methodNotAllowed(http.MethodGet))

	mux.HandleFunc("POST /api/v1/operations/{operation}", s.handleCalculate)
	mux.HandleFunc("/api/v1/operations/{operation}", s.methodNotAllowed(http.MethodPost))

	// Catch-all, so an unknown path also answers in JSON.
	mux.HandleFunc("/", s.handleNotFound)

	// Outermost first: the request id is assigned before anything logs, logging
	// then sees the final status, CORS headers are applied to every response
	// including errors, and panics become a JSON 500.
	return withRequestID(logRequests(s.logger, withCORS(allowedOrigin, recoverPanic(s.logger, mux))))
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.logger, http.StatusOK, map[string]string{"status": "ok"})
}

// handleListOperations lets a client discover the supported operations and
// their arity rather than hard-coding them.
func (s *server) handleListOperations(w http.ResponseWriter, _ *http.Request) {
	defs := calc.Definitions()
	out := make([]operationResponse, len(defs))
	for i, def := range defs {
		out[i] = operationResponse{
			Operation:   def.Op,
			Arity:       def.Arity,
			Description: def.Description,
		}
	}
	writeJSON(w, s.logger, http.StatusOK, map[string]any{"operations": out})
}

func (s *server) handleCalculate(w http.ResponseWriter, r *http.Request) {
	op := calc.Operation(r.PathValue("operation"))

	// Resolve the operation first: an unknown one is a 404 regardless of what
	// the body contains, and knowing the arity is what makes operand
	// validation possible.
	def, err := calc.Lookup(op)
	if err != nil {
		writeError(w, s.logger, fromDomainError(err), r)
		return
	}

	if apiErr := requireJSONContentType(r); apiErr != nil {
		writeError(w, s.logger, apiErr, r)
		return
	}

	req, apiErr := decodeCalculateRequest(w, r)
	if apiErr != nil {
		writeError(w, s.logger, apiErr, r)
		return
	}

	a, b, apiErr := validateOperands(def, req)
	if apiErr != nil {
		writeError(w, s.logger, apiErr, r)
		return
	}

	result, err := calc.Evaluate(op, a, b)
	if err != nil {
		writeError(w, s.logger, fromDomainError(err), r)
		return
	}

	resp := calculateResponse{
		Operation: op,
		Operands:  operands{A: a},
		Result:    result,
	}
	if def.Arity == calc.Binary {
		resp.Operands.B = &b
	}
	writeJSON(w, s.logger, http.StatusOK, resp)
}

// requireJSONContentType rejects a body whose media type is not JSON. Guessing
// at an unlabelled body is how a client silently sends the wrong thing for a
// long time, so the header is mandatory rather than assumed.
func requireJSONContentType(r *http.Request) *apiError {
	header := r.Header.Get("Content-Type")
	if header == "" {
		return newAPIError(http.StatusUnsupportedMediaType, CodeUnsupportedMediaType,
			`the Content-Type header is required and must be "application/json"`)
	}

	// ParseMediaType strips parameters, so "application/json; charset=utf-8" is
	// accepted as the same media type.
	mediaType, _, err := mime.ParseMediaType(header)
	if err != nil || mediaType != "application/json" {
		return newAPIError(http.StatusUnsupportedMediaType, CodeUnsupportedMediaType,
			fmt.Sprintf("unsupported Content-Type %q; expected application/json", header))
	}
	return nil
}

// decodeCalculateRequest reads the body strictly: unknown fields, trailing
// content and oversized payloads are all rejected, so a typo like {"x":1}
// fails loudly instead of being silently treated as a missing operand.
func decodeCalculateRequest(w http.ResponseWriter, r *http.Request) (calculateRequest, *apiError) {
	var req calculateRequest

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(&req); err != nil {
		return req, decodeError(err)
	}

	// A second JSON value after the object means the client sent something
	// other than the single object this endpoint documents.
	if dec.More() {
		return req, newAPIError(http.StatusBadRequest, CodeInvalidJSON,
			"request body must contain a single JSON object")
	}

	return req, nil
}

// decodeError turns a json decoding failure into a message a client can act on.
func decodeError(err error) *apiError {
	var maxBytesErr *http.MaxBytesError
	var typeErr *json.UnmarshalTypeError
	var syntaxErr *json.SyntaxError

	switch {
	case errors.Is(err, io.EOF):
		return newAPIError(http.StatusBadRequest, CodeInvalidJSON,
			"request body is empty; expected a JSON object")

	case errors.As(err, &maxBytesErr):
		return newAPIError(http.StatusRequestEntityTooLarge, CodeRequestTooLarge,
			fmt.Sprintf("request body must not exceed %d bytes", maxRequestBodyBytes))

	case errors.As(err, &syntaxErr):
		return newAPIError(http.StatusBadRequest, CodeInvalidJSON,
			fmt.Sprintf("request body contains malformed JSON at byte %d", syntaxErr.Offset))

	case errors.As(err, &typeErr):
		// Also covers numbers that overflow float64, such as 1e400.
		return newAPIError(http.StatusBadRequest, CodeInvalidOperands,
			fmt.Sprintf("field %q must be a number that fits in a 64-bit float", typeErr.Field))

	default:
		// DisallowUnknownFields reports a plain error, so it lands here.
		return newAPIError(http.StatusBadRequest, CodeInvalidJSON, err.Error())
	}
}

// validateOperands enforces the operation's arity. Supplying "b" to a unary
// operation is rejected rather than ignored: silently dropping an operand hides
// a genuine client bug.
func validateOperands(def calc.Definition, req calculateRequest) (float64, float64, *apiError) {
	if req.A == nil {
		return 0, 0, newAPIError(http.StatusBadRequest, CodeInvalidOperands,
			`operand "a" is required`)
	}

	switch def.Arity {
	case calc.Unary:
		if req.B != nil {
			return 0, 0, newAPIError(http.StatusBadRequest, CodeInvalidOperands,
				fmt.Sprintf(`operation %q takes a single operand; remove "b"`, def.Op))
		}
		return *req.A, 0, nil

	default:
		if req.B == nil {
			return 0, 0, newAPIError(http.StatusBadRequest, CodeInvalidOperands,
				fmt.Sprintf(`operand "b" is required for operation %q`, def.Op))
		}
		return *req.A, *req.B, nil
	}
}

// methodNotAllowed answers requests that hit a known path with the wrong verb.
func (s *server) methodNotAllowed(allowed ...string) http.HandlerFunc {
	allowHeader := ""
	for i, m := range allowed {
		if i > 0 {
			allowHeader += ", "
		}
		allowHeader += m
	}
	// OPTIONS is handled by the CORS middleware but still belongs in Allow.
	allowHeader += ", OPTIONS"

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", allowHeader)
		writeError(w, s.logger, newAPIError(http.StatusMethodNotAllowed, CodeMethodNotAllowed,
			fmt.Sprintf("method %s is not allowed for this endpoint", r.Method)), r)
	}
}

func (s *server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, s.logger, newAPIError(http.StatusNotFound, CodeNotFound,
		fmt.Sprintf("no endpoint matches %s", r.URL.Path)), r)
}

// writeJSON serialises payload. It encodes into a buffer first so that a
// marshalling failure can still produce a clean 500 rather than a truncated
// body appended to an already-sent 200.
func writeJSON(w http.ResponseWriter, logger *slog.Logger, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		logger.Error("failed to encode response", slog.Any("error", err))
		http.Error(w, `{"error":{"code":"internal_error","message":"failed to encode response"}}`,
			http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		// The client hung up mid-write; nothing to do but record it.
		logger.Warn("failed to write response body", slog.Any("error", err))
	}
}

// writeError renders an error, stamping it with the request id so someone
// reporting a failure can quote something that appears in the logs.
func writeError(w http.ResponseWriter, logger *slog.Logger, apiErr *apiError, r *http.Request) {
	detail := apiErr.detail
	detail.RequestID = requestIDFrom(r.Context())
	writeJSON(w, logger, apiErr.status, errorResponse{Error: detail})
}
