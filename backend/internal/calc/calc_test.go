package calc_test

import (
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/Matheus-Mont/calculator/backend/internal/calc"
)

func TestEvaluate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		op   calc.Operation
		a, b float64
		want float64
	}{
		// Addition.
		{"add positives", calc.Add, 2, 3, 5},
		{"add negatives", calc.Add, -2, -3, -5},
		{"add mixed signs", calc.Add, -7, 3, -4},
		{"add decimals", calc.Add, 1.5, 2.25, 3.75},
		{"add identity", calc.Add, 42, 0, 42},

		// Subtraction.
		{"subtract positives", calc.Subtract, 10, 4, 6},
		{"subtract into negative", calc.Subtract, 4, 10, -6},
		{"subtract negative operand", calc.Subtract, 5, -5, 10},
		{"subtract decimals", calc.Subtract, 0.75, 0.25, 0.5},

		// Multiplication.
		{"multiply positives", calc.Multiply, 6, 7, 42},
		{"multiply by zero", calc.Multiply, 12345, 0, 0},
		{"multiply negatives", calc.Multiply, -3, -4, 12},
		{"multiply mixed signs", calc.Multiply, -3, 4, -12},
		{"multiply decimals", calc.Multiply, 2.5, 4, 10},

		// Division.
		{"divide evenly", calc.Divide, 10, 2, 5},
		{"divide to fraction", calc.Divide, 10, 4, 2.5},
		{"divide negatives", calc.Divide, -10, -2, 5},
		{"divide zero numerator", calc.Divide, 0, 5, 0},

		// Power.
		{"power positive exponent", calc.Power, 2, 10, 1024},
		{"power zero exponent", calc.Power, 5, 0, 1},
		// Go follows IEEE-754 here: 0^0 is defined as 1.
		{"power zero base and exponent", calc.Power, 0, 0, 1},
		{"power negative exponent", calc.Power, 2, -2, 0.25},
		{"power fractional exponent", calc.Power, 9, 0.5, 3},
		{"power negative base", calc.Power, -2, 3, -8},

		// Square root (unary: b is ignored).
		{"sqrt perfect square", calc.Sqrt, 81, 0, 9},
		{"sqrt of zero", calc.Sqrt, 0, 0, 0},
		{"sqrt of one", calc.Sqrt, 1, 0, 1},
		{"sqrt of decimal", calc.Sqrt, 6.25, 0, 2.5},
		{"sqrt ignores second operand", calc.Sqrt, 16, 999, 4},

		// Percentage: "a percent of b".
		{"percentage basic", calc.Percentage, 20, 50, 10},
		{"percentage whole", calc.Percentage, 100, 250, 250},
		{"percentage of zero", calc.Percentage, 50, 0, 0},
		{"percentage zero percent", calc.Percentage, 0, 500, 0},
		{"percentage fractional", calc.Percentage, 12.5, 200, 25},
		{"percentage negative base", calc.Percentage, 10, -200, -20},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := calc.Evaluate(tc.op, tc.a, tc.b)
			if err != nil {
				t.Fatalf("Evaluate(%q, %v, %v) returned unexpected error: %v", tc.op, tc.a, tc.b, err)
			}
			// Compare with a tolerance: binary floating point cannot represent
			// most decimal fractions exactly, so 1.5+2.25 style cases are only
			// meaningful within an epsilon.
			if math.Abs(got-tc.want) > 1e-9 {
				t.Errorf("Evaluate(%q, %v, %v) = %v, want %v", tc.op, tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestEvaluateDomainErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		op      calc.Operation
		a, b    float64
		wantErr error
	}{
		{"divide by zero", calc.Divide, 10, 0, calc.ErrDivisionByZero},
		{"divide zero by zero", calc.Divide, 0, 0, calc.ErrDivisionByZero},
		{"divide negative by zero", calc.Divide, -10, 0, calc.ErrDivisionByZero},

		{"sqrt of negative", calc.Sqrt, -9, 0, calc.ErrNegativeSquareRoot},
		{"sqrt of tiny negative", calc.Sqrt, -0.0001, 0, calc.ErrNegativeSquareRoot},

		{"unknown operation", calc.Operation("modulo"), 10, 3, calc.ErrUnsupportedOperation},
		{"empty operation", calc.Operation(""), 1, 1, calc.ErrUnsupportedOperation},

		// Overflow guards: these all produce ±Inf or NaN, which encoding/json
		// cannot marshal. They must surface as a domain error, not a 500.
		{"multiplication overflows", calc.Multiply, math.MaxFloat64, 10, calc.ErrResultNotFinite},
		{"addition overflows", calc.Add, math.MaxFloat64, math.MaxFloat64, calc.ErrResultNotFinite},
		{"power overflows", calc.Power, 10, 400, calc.ErrResultNotFinite},
		{"zero to negative power is infinite", calc.Power, 0, -1, calc.ErrResultNotFinite},
		{"percentage overflows", calc.Percentage, math.MaxFloat64, 1000, calc.ErrResultNotFinite},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := calc.Evaluate(tc.op, tc.a, tc.b)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("Evaluate(%q, %v, %v) error = %v, want %v", tc.op, tc.a, tc.b, err, tc.wantErr)
			}
			if got != 0 {
				t.Errorf("Evaluate(%q, %v, %v) = %v on error, want zero value", tc.op, tc.a, tc.b, got)
			}
		})
	}
}

func TestLookup(t *testing.T) {
	t.Parallel()

	t.Run("returns definition for known operation", func(t *testing.T) {
		t.Parallel()

		def, err := calc.Lookup(calc.Divide)
		if err != nil {
			t.Fatalf("Lookup(divide) returned error: %v", err)
		}
		if def.Op != calc.Divide {
			t.Errorf("def.Op = %q, want %q", def.Op, calc.Divide)
		}
		if def.Arity != calc.Binary {
			t.Errorf("def.Arity = %d, want %d", def.Arity, calc.Binary)
		}
		if def.Description == "" {
			t.Error("def.Description is empty; every operation should document itself")
		}
	})

	t.Run("reports unknown operation with its name", func(t *testing.T) {
		t.Parallel()

		_, err := calc.Lookup(calc.Operation("modulo"))
		if !errors.Is(err, calc.ErrUnsupportedOperation) {
			t.Fatalf("Lookup(modulo) error = %v, want ErrUnsupportedOperation", err)
		}
		// The name is included so the API error message can be specific.
		if !strings.Contains(err.Error(), "modulo") {
			t.Errorf("error %q should name the unsupported operation", err)
		}
	})
}

func TestSqrtIsTheOnlyUnaryOperation(t *testing.T) {
	t.Parallel()

	for _, def := range calc.Definitions() {
		wantArity := calc.Binary
		if def.Op == calc.Sqrt {
			wantArity = calc.Unary
		}
		if def.Arity != wantArity {
			t.Errorf("%q has arity %d, want %d", def.Op, def.Arity, wantArity)
		}
	}
}

func TestDefinitionsAreSortedAndComplete(t *testing.T) {
	t.Parallel()

	defs := calc.Definitions()
	want := []calc.Operation{
		calc.Add, calc.Divide, calc.Multiply, calc.Percentage,
		calc.Power, calc.Sqrt, calc.Subtract,
	}
	if len(defs) != len(want) {
		t.Fatalf("Definitions() returned %d operations, want %d", len(defs), len(want))
	}
	// Sorted order matters: it keeps GET /api/v1/operations stable between
	// runs, since Go randomises map iteration.
	for i, op := range want {
		if defs[i].Op != op {
			t.Errorf("Definitions()[%d] = %q, want %q", i, defs[i].Op, op)
		}
		if defs[i].Description == "" {
			t.Errorf("%q is missing a description", defs[i].Op)
		}
	}
}

func TestSupportedOperationsMatchesDefinitions(t *testing.T) {
	t.Parallel()

	ops := calc.SupportedOperations()
	defs := calc.Definitions()
	if len(ops) != len(defs) {
		t.Fatalf("SupportedOperations() has %d entries, Definitions() has %d", len(ops), len(defs))
	}
	for i := range ops {
		if ops[i] != defs[i].Op {
			t.Errorf("SupportedOperations()[%d] = %q, want %q", i, ops[i], defs[i].Op)
		}
	}
}

// TestEveryOperationIsEvaluable guards against a registry entry being added
// without a working apply function.
func TestEveryOperationIsEvaluable(t *testing.T) {
	t.Parallel()

	for _, def := range calc.Definitions() {
		// Operands chosen to be valid for every operation, including sqrt
		// (non-negative) and divide (non-zero divisor).
		if _, err := calc.Evaluate(def.Op, 4, 2); err != nil {
			t.Errorf("Evaluate(%q, 4, 2) returned error: %v", def.Op, err)
		}
	}
}
