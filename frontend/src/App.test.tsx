import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';
import type { CalculateOutcome } from './api/client';
import type { Operation } from './types';

/** Stub backend, so these tests cover the UI wiring rather than the network. */
function stubCalculate(result: number | 'error' = 0) {
  return vi.fn(async (operation: Operation, a: number, b?: number): Promise<CalculateOutcome> => {
    if (result === 'error') {
      return { ok: false, error: { code: 'division_by_zero', message: 'cannot divide by zero' } };
    }
    return {
      ok: true,
      data: { operation, operands: b === undefined ? { a } : { a, b }, result },
    };
  });
}

function renderApp(calculate = stubCalculate()) {
  render(<App calculatorOptions={{ calculate }} />);
  return { user: userEvent.setup(), calculate };
}

/** Presses keypad buttons by their accessible name. */
async function press(user: ReturnType<typeof userEvent.setup>, ...labels: string[]) {
  for (const label of labels) {
    await user.click(screen.getByRole('button', { name: label }));
  }
}

function displayValue() {
  return screen.getByTestId('display-value').textContent;
}

describe('rendering', () => {
  it('shows zero on first paint', () => {
    renderApp();
    expect(displayValue()).toBe('0');
  });

  it('exposes every operation as a labelled button', () => {
    renderApp();

    for (const label of ['Add', 'Subtract', 'Multiply', 'Divide', 'Power', 'Percentage', 'Square root']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('starts with an empty history', () => {
    renderApp();
    expect(screen.getByText(/calculations you run will appear here/i)).toBeInTheDocument();
  });
});

describe('performing a calculation', () => {
  it('multiplies via the keypad', async () => {
    const { user, calculate } = renderApp(stubCalculate(56));

    await press(user, '7', 'Multiply', '8', 'Equals');

    expect(calculate).toHaveBeenCalledWith('multiply', 7, 8);
    await waitFor(() => expect(displayValue()).toBe('56'));
  });

  it('shows the pending expression', async () => {
    const { user } = renderApp();

    await press(user, '1', '2', 'Divide');

    expect(screen.getByTestId('expression')).toHaveTextContent('12 ÷');
  });

  it('applies a square root immediately', async () => {
    const { user, calculate } = renderApp(stubCalculate(9));

    await press(user, '8', '1', 'Square root');

    expect(calculate).toHaveBeenCalledWith('sqrt', 81);
    await waitFor(() => expect(displayValue()).toBe('9'));
  });

  it('records the calculation in history', async () => {
    const { user } = renderApp(stubCalculate(56));

    await press(user, '7', 'Multiply', '8', 'Equals');

    const history = screen.getByRole('list');
    await waitFor(() => expect(within(history).getByText('7 × 8')).toBeInTheDocument());
    expect(within(history).getByText('= 56')).toBeInTheDocument();
  });

  it('clears the display without clearing history', async () => {
    const { user } = renderApp(stubCalculate(56));

    await press(user, '7', 'Multiply', '8', 'Equals');
    await waitFor(() => expect(displayValue()).toBe('56'));

    await press(user, 'Clear all');

    expect(displayValue()).toBe('0');
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('clears history on demand', async () => {
    const { user } = renderApp(stubCalculate(56));

    await press(user, '7', 'Multiply', '8', 'Equals');
    await waitFor(() => expect(screen.getByRole('list')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText(/calculations you run will appear here/i)).toBeInTheDocument();
  });
});

describe('every keypad key is wired up', () => {
  // Each operator key must send its own operation; a copy-paste slip in the
  // keypad would otherwise route two keys to the same endpoint unnoticed.
  it.each([
    ['Add', 'add'],
    ['Subtract', 'subtract'],
    ['Multiply', 'multiply'],
    ['Divide', 'divide'],
    ['Power', 'power'],
    ['Percentage', 'percentage'],
  ])('%s sends the %s operation', async (label, operation) => {
    const { user, calculate } = renderApp();

    await press(user, '6', label, '2', 'Equals');

    expect(calculate).toHaveBeenCalledWith(operation, 6, 2);
  });

  it('types every digit', async () => {
    const { user } = renderApp();

    await press(user, '1', '2', '3', '4', '5', '6', '7', '8', '9');
    expect(displayValue()).toBe('123456789');

    await press(user, 'Backspace');
    expect(displayValue()).toBe('12345678');
  });

  it('enters a decimal point', async () => {
    const { user } = renderApp();

    await press(user, '3', 'Decimal point', '1', '4');

    expect(displayValue()).toBe('3.14');
  });

  it('toggles the sign', async () => {
    const { user } = renderApp();

    await press(user, '5', 'Toggle sign');
    expect(displayValue()).toBe('-5');

    await press(user, 'Toggle sign');
    expect(displayValue()).toBe('5');
  });

  it('negates a computed result', async () => {
    const { user } = renderApp(stubCalculate(56));

    await press(user, '7', 'Multiply', '8', 'Equals');
    await waitFor(() => expect(displayValue()).toBe('56'));

    await press(user, 'Toggle sign');
    expect(displayValue()).toBe('-56');
  });

  it('ignores a sign toggle when nothing has been entered', async () => {
    const { user } = renderApp();

    await press(user, 'Toggle sign');

    expect(displayValue()).toBe('0');
  });

  it('ignores a backspace when nothing has been entered', async () => {
    const { user } = renderApp();

    await press(user, 'Backspace');

    expect(displayValue()).toBe('0');
  });
});

describe('history is collapsed to the latest result', () => {
  /** Runs `count` calculations so the history has something to collapse. */
  async function fillHistory(user: ReturnType<typeof userEvent.setup>, count: number) {
    for (let i = 1; i <= count; i++) {
      await press(user, 'Clear all', String(i), 'Multiply', '7', 'Equals');
      await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    }
  }

  it('shows only the most recent entry', async () => {
    const { user } = renderApp();

    await fillHistory(user, 3);

    // The newest calculation is the one worth glancing at while working.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('3 × 7')).toBeInTheDocument();
    expect(screen.queryByText('1 × 7')).not.toBeInTheDocument();
  });

  it('offers to reveal the rest, counting what is hidden', async () => {
    const { user } = renderApp();

    await fillHistory(user, 4);

    expect(screen.getByRole('button', { name: 'Show 3 more' })).toBeInTheDocument();
  });

  it('expands to every entry and collapses again', async () => {
    const { user } = renderApp();

    await fillHistory(user, 4);
    await user.click(screen.getByRole('button', { name: 'Show 3 more' }));

    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('1 × 7')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show less' }));

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('marks the toggle as expanded for assistive technology', async () => {
    const { user } = renderApp();

    await fillHistory(user, 2);
    const toggle = screen.getByRole('button', { name: 'Show 1 more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });

  // With a single calculation there is nothing behind the toggle, so offering
  // one would be a control that does nothing.
  it('offers no toggle when only one calculation exists', async () => {
    const { user } = renderApp(stubCalculate(56));

    await press(user, '7', 'Multiply', '8', 'Equals');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    expect(screen.queryByRole('button', { name: /show/i })).not.toBeInTheDocument();
  });

  it('offers no clear button until there is something to clear', async () => {
    const { user } = renderApp(stubCalculate(56));

    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    await press(user, '7', 'Multiply', '8', 'Equals');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument());
  });
});

describe('error handling', () => {
  it('announces a failed calculation', async () => {
    const { user } = renderApp(stubCalculate('error'));

    await press(user, '1', '0', 'Divide', '0', 'Equals');

    // role="alert" so the message is announced without the user hunting for it.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('cannot divide by zero');
  });

  it('lets the error be dismissed', async () => {
    const { user } = renderApp(stubCalculate('error'));

    await press(user, '1', 'Divide', '0', 'Equals');
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Dismiss error' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('loading state', () => {
  it('disables the keypad and announces progress while a request is in flight', async () => {
    let release: (outcome: CalculateOutcome) => void = () => {};
    const pending = new Promise<CalculateOutcome>((resolve) => {
      release = resolve;
    });
    const { user } = renderApp(vi.fn(() => pending));

    await press(user, '2', 'Add', '3');
    await user.click(screen.getByRole('button', { name: 'Equals' }));

    expect(await screen.findByRole('status', { name: 'Calculating' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Equals' })).toBeDisabled();

    release({ ok: true, data: { operation: 'add', operands: { a: 2, b: 3 }, result: 5 } });

    await waitFor(() => expect(displayValue()).toBe('5'));
    expect(screen.getByRole('button', { name: 'Equals' })).toBeEnabled();
  });
});

describe('keyboard support', () => {
  it('accepts digits and operators typed on a physical keyboard', async () => {
    const { user, calculate } = renderApp(stubCalculate(56));

    await user.keyboard('7*8{Enter}');

    expect(calculate).toHaveBeenCalledWith('multiply', 7, 8);
    await waitFor(() => expect(displayValue()).toBe('56'));
  });

  it('clears on Escape', async () => {
    const { user } = renderApp();

    await user.keyboard('123');
    expect(displayValue()).toBe('123');

    await user.keyboard('{Escape}');
    expect(displayValue()).toBe('0');
  });

  it('deletes a digit on Backspace', async () => {
    const { user } = renderApp();

    await user.keyboard('123{Backspace}');

    expect(displayValue()).toBe('12');
  });

  it('maps R to square root', async () => {
    const { user, calculate } = renderApp(stubCalculate(9));

    await user.keyboard('81r');

    expect(calculate).toHaveBeenCalledWith('sqrt', 81);
  });

  it('ignores keys it does not handle', async () => {
    const { user, calculate } = renderApp();

    await user.keyboard('abc');

    expect(displayValue()).toBe('0');
    expect(calculate).not.toHaveBeenCalled();
  });
});
