// Package calc implements the calculator's arithmetic domain.
//
// It is deliberately free of any transport concerns: nothing here knows about
// HTTP, JSON, or request handling. That keeps the arithmetic rules directly
// unit-testable and lets the HTTP layer be swapped or extended without
// touching the maths.
package calc

import (
	"errors"
	"fmt"
	"math"
	"sort"
)

// Operation is the canonical identifier of a calculator operation, as it
// appears in the API path (e.g. POST /api/v1/operations/divide).
type Operation string

const (
	Add        Operation = "add"
	Subtract   Operation = "subtract"
	Multiply   Operation = "multiply"
	Divide     Operation = "divide"
	Power      Operation = "power"
	Sqrt       Operation = "sqrt"
	Percentage Operation = "percentage"
)

// Domain errors. The HTTP layer maps these sentinels onto status codes and
// machine-readable error codes, so callers can switch on them with errors.Is
// rather than matching on message text.
var (
	// ErrDivisionByZero is returned when a division has a zero divisor.
	ErrDivisionByZero = errors.New("cannot divide by zero")

	// ErrNegativeSquareRoot is returned for the square root of a negative
	// number, which has no real-valued result.
	ErrNegativeSquareRoot = errors.New("cannot take the square root of a negative number")

	// ErrUnsupportedOperation is returned when an unknown operation is requested.
	ErrUnsupportedOperation = errors.New("unsupported operation")

	// ErrResultNotFinite is returned when an operation overflows float64 and
	// produces an infinity or NaN. Such values cannot be represented in JSON,
	// so they are rejected rather than silently corrupting the response.
	ErrResultNotFinite = errors.New("result is not a finite number")
)

// Arity describes how many operands an operation consumes.
const (
	Unary  = 1
	Binary = 2
)

// Definition describes a single operation: how many operands it takes, what it
// means, and how to compute it. Keeping these together in one registry means
// the compute handler and the "list operations" endpoint cannot drift apart,
// and adding an operation is a single-entry change.
type Definition struct {
	Op          Operation
	Arity       int
	Description string

	// apply computes the raw result. For unary operations b is ignored.
	// Implementations return a domain error for inputs that are undefined;
	// overflow to ±Inf/NaN is caught centrally by Evaluate.
	apply func(a, b float64) (float64, error)
}

// registry is the single source of truth for supported operations.
//
// Percentage is genuinely ambiguous in calculator UIs, so this codebase commits
// to one reading: percentage(a, b) is "a percent of b", i.e. (a/100)*b. So
// percentage(20, 50) == 10. See README for the alternatives considered.
var registry = map[Operation]Definition{
	Add: {
		Op: Add, Arity: Binary, Description: "Adds b to a (a + b).",
		apply: func(a, b float64) (float64, error) { return a + b, nil },
	},
	Subtract: {
		Op: Subtract, Arity: Binary, Description: "Subtracts b from a (a - b).",
		apply: func(a, b float64) (float64, error) { return a - b, nil },
	},
	Multiply: {
		Op: Multiply, Arity: Binary, Description: "Multiplies a by b (a * b).",
		apply: func(a, b float64) (float64, error) { return a * b, nil },
	},
	Divide: {
		Op: Divide, Arity: Binary, Description: "Divides a by b (a / b). b must not be zero.",
		apply: func(a, b float64) (float64, error) {
			// Guard explicitly: in IEEE-754 float division by zero yields
			// ±Inf (or NaN for 0/0) instead of panicking, which would leak a
			// nonsensical result to the client.
			if b == 0 {
				return 0, ErrDivisionByZero
			}
			return a / b, nil
		},
	},
	Power: {
		Op: Power, Arity: Binary, Description: "Raises a to the power of b (a ^ b).",
		apply: func(a, b float64) (float64, error) { return math.Pow(a, b), nil },
	},
	Sqrt: {
		Op: Sqrt, Arity: Unary, Description: "Square root of a. a must not be negative.",
		apply: func(a, _ float64) (float64, error) {
			// math.Sqrt of a negative returns NaN; reject it as a domain error
			// so the client gets a precise reason rather than a generic one.
			if a < 0 {
				return 0, ErrNegativeSquareRoot
			}
			return math.Sqrt(a), nil
		},
	},
	Percentage: {
		Op: Percentage, Arity: Binary, Description: "Computes a percent of b ((a / 100) * b).",
		apply: func(a, b float64) (float64, error) { return (a / 100) * b, nil },
	},
}

// Lookup returns the definition for op.
func Lookup(op Operation) (Definition, error) {
	def, ok := registry[op]
	if !ok {
		return Definition{}, fmt.Errorf("%w: %q", ErrUnsupportedOperation, op)
	}
	return def, nil
}

// Definitions returns every supported operation, ordered by name so that API
// responses and documentation are stable across runs (Go map iteration is not).
func Definitions() []Definition {
	defs := make([]Definition, 0, len(registry))
	for _, def := range registry {
		defs = append(defs, def)
	}
	sort.Slice(defs, func(i, j int) bool { return defs[i].Op < defs[j].Op })
	return defs
}

// SupportedOperations returns the names of every supported operation, sorted.
// Used to make "unsupported operation" errors self-documenting.
func SupportedOperations() []Operation {
	defs := Definitions()
	ops := make([]Operation, len(defs))
	for i, def := range defs {
		ops[i] = def.Op
	}
	return ops
}

// Evaluate applies op to the given operands. For unary operations b is ignored;
// validating that a caller supplied the right number of operands is the
// transport layer's job, since only it can tell "absent" from "zero".
//
// Every result passes through a finiteness check: overflow (1e308 * 10), or
// forms like 0^-1, produce ±Inf, and encoding/json cannot marshal those. Failing
// here turns what would be a 500 into a precise, documented client error.
func Evaluate(op Operation, a, b float64) (float64, error) {
	def, err := Lookup(op)
	if err != nil {
		return 0, err
	}

	result, err := def.apply(a, b)
	if err != nil {
		return 0, err
	}

	if math.IsInf(result, 0) || math.IsNaN(result) {
		return 0, ErrResultNotFinite
	}
	return result, nil
}
