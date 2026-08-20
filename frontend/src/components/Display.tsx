import { memo } from 'react';

interface DisplayProps {
  /** The expression in progress, e.g. "12 ÷". Empty when nothing is pending. */
  expression: string;
  /** The current value or live entry. */
  value: string;
  isLoading: boolean;
}

/**
 * The calculator's screen.
 *
 * The value is announced politely to screen readers so a result computed by the
 * API is heard without stealing focus from the keypad.
 */
export const Display = memo(function Display({ expression, value, isLoading }: DisplayProps) {
  return (
    <div className="display" data-testid="display">
      <div className="display__expression" data-testid="expression">
        {expression || ' '}
      </div>
      <output
        className="display__value"
        data-testid="display-value"
        aria-live="polite"
        aria-busy={isLoading}
        // Long results scroll rather than overflowing the panel.
        title={value}
      >
        {value}
      </output>
      {isLoading && (
        <span className="display__spinner" role="status" aria-label="Calculating">
          <span className="display__spinner-dot" />
        </span>
      )}
    </div>
  );
});
