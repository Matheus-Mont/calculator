package httpapi

import (
	"errors"
	"net/http"

	"gitlab.com/mathspa98/calculator/backend/internal/calc"
)

// ErrorCode is a stable, machine-readable identifier for a failure. Clients are
// expected to branch on these rather than on human-readable messages, which are
// free to change.
type ErrorCode string

const (
	CodeInvalidJSON          ErrorCode = "invalid_json"
	CodeInvalidOperands      ErrorCode = "invalid_operands"
	CodeDivisionByZero       ErrorCode = "division_by_zero"
	CodeNegativeSquareRoot   ErrorCode = "negative_square_root"
	CodeUnsupportedOperation ErrorCode = "unsupported_operation"
	CodeResultNotFinite      ErrorCode = "result_not_finite"
	CodeMethodNotAllowed     ErrorCode = "method_not_allowed"
	CodeUnsupportedMediaType ErrorCode = "unsupported_media_type"
	CodeNotFound             ErrorCode = "not_found"
	CodeRequestTooLarge      ErrorCode = "request_too_large"
	CodeInternalError        ErrorCode = "internal_error"
)

// errorResponse is the single error envelope used by every endpoint. Having one
// shape means a client can parse failures without knowing which route produced
// them.
type errorResponse struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
	// SupportedOperations is populated only for unsupported_operation, so the
	// error is self-documenting and a client need not guess the valid set.
	SupportedOperations []calc.Operation `json:"supported_operations,omitempty"`
	// RequestID matches the X-Request-Id response header and the server logs.
	RequestID string `json:"request_id,omitempty"`
}

// apiError couples an HTTP status with the payload to render. It implements
// error so it can flow through handlers using ordinary Go error returns.
type apiError struct {
	status int
	detail errorDetail
}

func (e *apiError) Error() string { return e.detail.Message }

func newAPIError(status int, code ErrorCode, message string) *apiError {
	return &apiError{status: status, detail: errorDetail{Code: code, Message: message}}
}

// fromDomainError translates a calc domain error into its HTTP representation.
//
// This mapping is the only place that knows both vocabularies, which is what
// lets internal/calc stay entirely transport-agnostic.
func fromDomainError(err error) *apiError {
	switch {
	case errors.Is(err, calc.ErrDivisionByZero):
		return newAPIError(http.StatusBadRequest, CodeDivisionByZero,
			"cannot divide by zero")

	case errors.Is(err, calc.ErrNegativeSquareRoot):
		return newAPIError(http.StatusBadRequest, CodeNegativeSquareRoot,
			"cannot take the square root of a negative number")

	case errors.Is(err, calc.ErrUnsupportedOperation):
		apiErr := newAPIError(http.StatusNotFound, CodeUnsupportedOperation,
			"unsupported operation")
		apiErr.detail.SupportedOperations = calc.SupportedOperations()
		return apiErr

	case errors.Is(err, calc.ErrResultNotFinite):
		// 422 rather than 400: the request was well-formed and the operands
		// were individually valid, but the result cannot be represented as a
		// finite float64 (and therefore not as JSON either).
		return newAPIError(http.StatusUnprocessableEntity, CodeResultNotFinite,
			"the result is too large to represent as a finite number")

	default:
		// Anything unmapped is a bug in this service, not a client mistake.
		return newAPIError(http.StatusInternalServerError, CodeInternalError,
			"an unexpected error occurred")
	}
}
