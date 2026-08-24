import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

interface DisplayProps {
  /** The expression in progress, e.g. "12 ÷". Empty when nothing is pending. */
  expression: string;
  /** The current value or live entry. */
  value: string;
  isLoading: boolean;
}

/**
 * Smallest the value is allowed to shrink to before it stays put and scrolls
 * instead. Below this it stops being readable, at which point a clipped number
 * is the lesser problem.
 */
const MIN_FONT_SIZE_PX = 15;

/**
 * The calculator's screen.
 *
 * The value is announced politely to screen readers so a result computed by the
 * API is heard without stealing focus from the keypad.
 */
export const Display = memo(function Display({ expression, value, isLoading }: DisplayProps) {
  const valueRef = useRef<HTMLOutputElement>(null);

  /**
   * Shrinks the value until it fits.
   *
   * A result like 6.33825300114e+29 is wider than the panel at the display's
   * natural size. Left alone it would be silently clipped — and with the
   * scrollbar hidden there is nothing to signal that the exponent is missing,
   * so the screen would show a number that is not the answer.
   */
  const fitValue = useCallback(() => {
    const element = valueRef.current;
    if (element === null) return;

    // Clear any previous adjustment first, or each pass compounds the last.
    element.style.fontSize = '';

    const available = element.clientWidth;
    const needed = element.scrollWidth;
    if (needed <= available || available === 0) return;

    const naturalSize = Number.parseFloat(getComputedStyle(element).fontSize);
    element.style.fontSize = `${Math.max(naturalSize * (available / needed), MIN_FONT_SIZE_PX)}px`;
  }, []);

  // Layout effect rather than an ordinary one: resizing after paint would show
  // the oversized number for a frame first.
  useLayoutEffect(fitValue, [fitValue, value]);

  // The available width changes with the viewport, so the fit has to be redone.
  useEffect(() => {
    window.addEventListener('resize', fitValue);
    return () => window.removeEventListener('resize', fitValue);
  }, [fitValue]);

  return (
    <div className="display" data-testid="display">
      <div className="display__expression" data-testid="expression">
        {expression || ' '}
      </div>
      <output
        ref={valueRef}
        className="display__value"
        data-testid="display-value"
        aria-live="polite"
        aria-busy={isLoading}
        // The untruncated value stays available on hover for the rare result
        // that hits the minimum font size and still overflows.
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
