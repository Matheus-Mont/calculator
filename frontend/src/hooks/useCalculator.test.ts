import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CalculateOutcome } from '../api/client';
import type { Operation } from '../types';
import { useCalculator } from './useCalculator';

/**
 * A stub backend that performs the arithmetic locally.
 *
 * The hook is responsible for *when* to call the API and what to do with the
 * answer; the arithmetic itself is the Go service's job and is tested there.
 */
function stubCalculate(overrides: Partial<Record<Operation, () => CalculateOutcome>> = {}) {
  return vi.fn(async (operation: Operation, a: number, b?: number): Promise<CalculateOutcome> => {
    const override = overrides[operation];
    if (override) return override();

    const results: Record<Operation, number> = {
      add: a + (b ?? 0),
      subtract: a - (b ?? 0),
      multiply: a * (b ?? 0),
      divide: a / (b ?? 1),
      power: a ** (b ?? 0),
      percentage: (a / 100) * (b ?? 0),
      sqrt: Math.sqrt(a),
    };

    return {
      ok: true,
      data: {
        operation,
        operands: b === undefined ? { a } : { a, b },
        result: results[operation],
      },
    };
  });
}

function setup(calculate = stubCalculate()) {
  const view = renderHook(() => useCalculator({ calculate }));
  return { ...view, calculate };
}

/** Types a multi-digit number one key at a time. */
function type(result: ReturnType<typeof setup>['result'], digits: string) {
  for (const char of digits) {
    act(() => {
      if (char === '.') {
        result.current.inputDecimal();
      } else {
        result.current.inputDigit(char);
      }
    });
  }
}

describe('entering numbers', () => {
  it('starts at zero', () => {
    const { result } = setup();
    expect(result.current.display).toBe('0');
  });

  it('accumulates digits', () => {
    const { result } = setup();
    type(result, '123');
    expect(result.current.display).toBe('123');
  });

  it('does not keep a leading zero', () => {
    const { result } = setup();
    type(result, '05');
    expect(result.current.display).toBe('5');
  });

  it('allows a decimal after a leading zero', () => {
    const { result } = setup();
    type(result, '0.5');
    expect(result.current.display).toBe('0.5');
  });

  it('starts a decimal with zero when nothing was typed', () => {
    const { result } = setup();
    act(() => result.current.inputDecimal());
    expect(result.current.display).toBe('0.');
  });

  it('ignores a second decimal point', () => {
    const { result } = setup();
    type(result, '1.5');
    act(() => result.current.inputDecimal());
    expect(result.current.display).toBe('1.5');
  });

  it('caps the length of an entry', () => {
    const { result } = setup();
    type(result, '12345678901234567890');
    expect(result.current.display.length).toBeLessThanOrEqual(16);
  });

  it('toggles the sign of the entry', () => {
    const { result } = setup();
    type(result, '42');
    act(() => result.current.toggleSign());
    expect(result.current.display).toBe('-42');

    act(() => result.current.toggleSign());
    expect(result.current.display).toBe('42');
  });

  it('removes the last digit on backspace', () => {
    const { result } = setup();
    type(result, '123');
    act(() => result.current.backspace());
    expect(result.current.display).toBe('12');
  });

  // Deleting the digit of "-5" would leave a bare "-", which is not a number.
  it('collapses a lone minus sign to zero', () => {
    const { result } = setup();
    type(result, '5');
    act(() => result.current.toggleSign());
    act(() => result.current.backspace());
    expect(result.current.display).toBe('0');
  });

  it('resets everything on clear', async () => {
    const { result } = setup();
    type(result, '99');
    await act(async () => result.current.chooseOperation('add'));
    act(() => result.current.clearAll());

    expect(result.current.display).toBe('0');
    expect(result.current.expression).toBe('');
  });
});

describe('calling the API', () => {
  it('does not call the backend while digits are being typed', () => {
    const { result, calculate } = setup();
    type(result, '123');
    expect(calculate).not.toHaveBeenCalled();
  });

  it('computes a binary operation on equals', async () => {
    const { result, calculate } = setup();

    type(result, '7');
    await act(async () => result.current.chooseOperation('multiply'));
    type(result, '8');
    await act(async () => result.current.evaluate());

    expect(calculate).toHaveBeenCalledWith('multiply', 7, 8);
    await waitFor(() => expect(result.current.display).toBe('56'));
  });

  it('shows the pending expression above the display', async () => {
    const { result } = setup();

    type(result, '12');
    await act(async () => result.current.chooseOperation('divide'));

    expect(result.current.expression).toBe('12 ÷');
  });

  // Chaining is what makes this a calculator rather than a form: pressing a
  // second operator has to flush the first operation.
  it('evaluates the pending operation when a second operator is pressed', async () => {
    const { result, calculate } = setup();

    type(result, '12');
    await act(async () => result.current.chooseOperation('divide'));
    type(result, '4');
    await act(async () => result.current.chooseOperation('add'));

    expect(calculate).toHaveBeenCalledWith('divide', 12, 4);
    await waitFor(() => expect(result.current.display).toBe('3'));

    type(result, '5');
    await act(async () => result.current.evaluate());

    expect(calculate).toHaveBeenLastCalledWith('add', 3, 5);
    await waitFor(() => expect(result.current.display).toBe('8'));
  });

  it('replaces the operator when two are pressed in a row', async () => {
    const { result, calculate } = setup();

    type(result, '5');
    await act(async () => result.current.chooseOperation('add'));
    await act(async () => result.current.chooseOperation('multiply'));
    type(result, '3');
    await act(async () => result.current.evaluate());

    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith('multiply', 5, 3);
  });

  it('continues from the previous result', async () => {
    const { result, calculate } = setup();

    type(result, '2');
    await act(async () => result.current.chooseOperation('add'));
    type(result, '3');
    await act(async () => result.current.evaluate());
    await waitFor(() => expect(result.current.display).toBe('5'));

    await act(async () => result.current.chooseOperation('multiply'));
    type(result, '4');
    await act(async () => result.current.evaluate());

    expect(calculate).toHaveBeenLastCalledWith('multiply', 5, 4);
    await waitFor(() => expect(result.current.display).toBe('20'));
  });

  it('starts a fresh number when a digit follows equals', async () => {
    const { result } = setup();

    type(result, '2');
    await act(async () => result.current.chooseOperation('add'));
    type(result, '3');
    await act(async () => result.current.evaluate());
    await waitFor(() => expect(result.current.display).toBe('5'));

    type(result, '9');
    expect(result.current.display).toBe('9');
  });

  // Physical calculators repeat the left operand for "5 + =".
  it('repeats the operand when equals is pressed with nothing typed', async () => {
    const { result, calculate } = setup();

    type(result, '5');
    await act(async () => result.current.chooseOperation('add'));
    await act(async () => result.current.evaluate());

    expect(calculate).toHaveBeenCalledWith('add', 5, 5);
  });

  it('ignores equals when no operation is pending', async () => {
    const { result, calculate } = setup();

    type(result, '5');
    await act(async () => result.current.evaluate());

    expect(calculate).not.toHaveBeenCalled();
  });

  it('applies a unary operation immediately, with no second operand', async () => {
    const { result, calculate } = setup();

    type(result, '81');
    await act(async () => result.current.applyUnary('sqrt'));

    expect(calculate).toHaveBeenCalledWith('sqrt', 81);
    await waitFor(() => expect(result.current.display).toBe('9'));
  });

  // A unary result must become the right-hand operand, not overwrite the
  // pending operation: 9 + √16 = 13.
  it('feeds a unary result into a pending operation', async () => {
    const { result, calculate } = setup();

    type(result, '9');
    await act(async () => result.current.chooseOperation('add'));
    type(result, '16');
    await act(async () => result.current.applyUnary('sqrt'));
    await waitFor(() => expect(result.current.display).toBe('4'));

    await act(async () => result.current.evaluate());

    expect(calculate).toHaveBeenLastCalledWith('add', 9, 4);
    await waitFor(() => expect(result.current.display).toBe('13'));
  });

  it('ignores a unary operation when there is nothing to operate on', async () => {
    const { result, calculate } = setup();
    await act(async () => result.current.applyUnary('sqrt'));
    expect(calculate).not.toHaveBeenCalled();
  });

  it('computes a percentage as "a percent of b"', async () => {
    const { result, calculate } = setup();

    type(result, '20');
    await act(async () => result.current.chooseOperation('percentage'));
    type(result, '50');
    await act(async () => result.current.evaluate());

    expect(calculate).toHaveBeenCalledWith('percentage', 20, 50);
    await waitFor(() => expect(result.current.display).toBe('10'));
  });
});

describe('loading state', () => {
  it('reports loading while a request is in flight', async () => {
    let release: (outcome: CalculateOutcome) => void = () => {};
    const pending = new Promise<CalculateOutcome>((resolve) => {
      release = resolve;
    });
    const calculate = vi.fn(() => pending);

    const { result } = setup(calculate);
    type(result, '2');
    await act(async () => result.current.chooseOperation('add'));
    type(result, '3');

    act(() => {
      void result.current.evaluate();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    await act(async () => {
      release({
        ok: true,
        data: { operation: 'add', operands: { a: 2, b: 3 }, result: 5 },
      });
      await pending;
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.display).toBe('5');
  });
});

describe('error handling', () => {
  it('surfaces the API error message', async () => {
    const calculate = stubCalculate({
      divide: () => ({ ok: false, error: { code: 'division_by_zero', message: 'cannot divide by zero' } }),
    });
    const { result } = setup(calculate);

    type(result, '10');
    await act(async () => result.current.chooseOperation('divide'));
    type(result, '0');
    await act(async () => result.current.evaluate());

    await waitFor(() => expect(result.current.error).toBe('cannot divide by zero'));
  });

  // The operands stay in place so the user can correct the divisor instead of
  // starting the whole calculation again.
  it('keeps the pending operation so the user can retry', async () => {
    const calculate = vi
      .fn<(op: Operation, a: number, b?: number) => Promise<CalculateOutcome>>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'division_by_zero', message: 'cannot divide by zero' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { operation: 'divide', operands: { a: 10, b: 2 }, result: 5 },
      });

    const { result } = setup(calculate);

    type(result, '10');
    await act(async () => result.current.chooseOperation('divide'));
    type(result, '0');
    await act(async () => result.current.evaluate());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    // Correct the divisor and try again.
    act(() => result.current.backspace());
    type(result, '2');
    await act(async () => result.current.evaluate());

    expect(calculate).toHaveBeenLastCalledWith('divide', 10, 2);
    await waitFor(() => expect(result.current.display).toBe('5'));
    expect(result.current.error).toBeNull();
  });

  it('clears the error as soon as a new digit is typed', async () => {
    const calculate = stubCalculate({
      divide: () => ({ ok: false, error: { code: 'division_by_zero', message: 'cannot divide by zero' } }),
    });
    const { result } = setup(calculate);

    type(result, '1');
    await act(async () => result.current.chooseOperation('divide'));
    type(result, '0');
    await act(async () => result.current.evaluate());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    type(result, '5');
    expect(result.current.error).toBeNull();
  });

  it('records nothing in history when a calculation fails', async () => {
    const calculate = stubCalculate({
      sqrt: () => ({ ok: false, error: { code: 'negative_square_root', message: 'no real root' } }),
    });
    const { result } = setup(calculate);

    type(result, '9');
    act(() => result.current.toggleSign());
    await act(async () => result.current.applyUnary('sqrt'));

    await waitFor(() => expect(result.current.error).toBe('no real root'));
    expect(result.current.history).toHaveLength(0);
  });
});

describe('reducer purity', () => {
  // StrictMode deliberately invokes reducers twice in development to surface
  // impure ones. A history id minted inside the reducer would make the same
  // dispatch produce two different states; minting it at dispatch time does not.
  it('records one history entry per calculation under StrictMode', async () => {
    const calculate = stubCalculate();
    const { result } = renderHook(() => useCalculator({ calculate }), { wrapper: StrictMode });

    type(result, '2');
    await act(async () => result.current.chooseOperation('add'));
    type(result, '3');
    await act(async () => result.current.evaluate());

    await waitFor(() => expect(result.current.display).toBe('5'));
    expect(result.current.history).toHaveLength(1);
  });

  it('gives every history entry a distinct id', async () => {
    const { result } = setup();

    for (const digit of ['1', '2', '3']) {
      type(result, digit);
      await act(async () => result.current.chooseOperation('add'));
      type(result, '1');
      await act(async () => result.current.evaluate());
      await waitFor(() => expect(result.current.error).toBeNull());
      act(() => result.current.clearAll());
    }

    const ids = result.current.history.map((entry) => entry.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('history', () => {
  it('records each successful calculation, newest first', async () => {
    const { result } = setup();

    type(result, '2');
    await act(async () => result.current.chooseOperation('add'));
    type(result, '3');
    await act(async () => result.current.evaluate());
    await waitFor(() => expect(result.current.history).toHaveLength(1));

    await act(async () => result.current.chooseOperation('multiply'));
    type(result, '4');
    await act(async () => result.current.evaluate());

    await waitFor(() => expect(result.current.history).toHaveLength(2));
    expect(result.current.history[0]).toMatchObject({ expression: '5 × 4', result: '20' });
    expect(result.current.history[1]).toMatchObject({ expression: '2 + 3', result: '5' });
  });

  it('records unary calculations in functional notation', async () => {
    const { result } = setup();

    type(result, '81');
    await act(async () => result.current.applyUnary('sqrt'));

    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(result.current.history[0]).toMatchObject({ expression: '√(81)', result: '9' });
  });

  it('survives a clear of the calculation', async () => {
    const { result } = setup();

    type(result, '2');
    await act(async () => result.current.chooseOperation('add'));
    type(result, '3');
    await act(async () => result.current.evaluate());
    await waitFor(() => expect(result.current.history).toHaveLength(1));

    act(() => result.current.clearAll());

    expect(result.current.display).toBe('0');
    expect(result.current.history).toHaveLength(1);
  });

  it('can be cleared on its own', async () => {
    const { result } = setup();

    type(result, '2');
    await act(async () => result.current.chooseOperation('add'));
    type(result, '3');
    await act(async () => result.current.evaluate());
    await waitFor(() => expect(result.current.history).toHaveLength(1));

    act(() => result.current.clearHistory());
    expect(result.current.history).toHaveLength(0);
  });
});
