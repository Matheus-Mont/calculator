import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Display } from './Display';

/**
 * jsdom performs no layout, so every element reports a width of zero. These
 * tests stub the two measurements the component reads, which is enough to cover
 * the sizing arithmetic — whether a real browser wraps or clips is verified by
 * eye, not here.
 */
function mockLayout({ available, needed }: { available: number; needed: number }) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(available);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(needed);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize: '44px' } as CSSStyleDeclaration);
}

function fontSizeOf(element: HTMLElement): number {
  return Number.parseFloat(element.style.fontSize || '0');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fitting the value to the panel', () => {
  it('leaves a value that already fits at its natural size', () => {
    mockLayout({ available: 400, needed: 120 });

    render(<Display expression="" value="56" isLoading={false} />);

    // No inline size at all: the stylesheet's clamp() stays in charge.
    expect(screen.getByTestId('display-value').style.fontSize).toBe('');
  });

  // Without shrinking, an overflowing result is silently clipped — and since
  // the scrollbar is hidden, nothing would signal that the exponent is missing.
  it('shrinks a value that overflows', () => {
    mockLayout({ available: 200, needed: 400 });

    render(<Display expression="" value="6.33825300114e+29" isLoading={false} />);

    // Half the needed width, so half the natural size.
    expect(fontSizeOf(screen.getByTestId('display-value'))).toBeCloseTo(22, 0);
  });

  it('stops shrinking at a readable floor', () => {
    mockLayout({ available: 10, needed: 4000 });

    render(<Display expression="" value="1.23456789012e+300" isLoading={false} />);

    expect(fontSizeOf(screen.getByTestId('display-value'))).toBeGreaterThanOrEqual(15);
  });

  // The previous adjustment has to be cleared before measuring, or successive
  // results would each shrink relative to the last until the value vanished.
  it('does not compound across successive values', () => {
    mockLayout({ available: 200, needed: 400 });

    const { rerender } = render(<Display expression="" value="1.11111111111e+29" isLoading={false} />);
    const first = fontSizeOf(screen.getByTestId('display-value'));

    rerender(<Display expression="" value="2.22222222222e+29" isLoading={false} />);

    expect(fontSizeOf(screen.getByTestId('display-value'))).toBeCloseTo(first, 5);
  });

  it('keeps the untruncated value available as a tooltip', () => {
    mockLayout({ available: 200, needed: 400 });

    render(<Display expression="" value="6.33825300114e+29" isLoading={false} />);

    expect(screen.getByTestId('display-value')).toHaveAttribute('title', '6.33825300114e+29');
  });

  // A zero width means the element is not laid out yet; dividing by it would
  // produce Infinity and wipe out the font size.
  it('leaves the value alone before layout has happened', () => {
    mockLayout({ available: 0, needed: 0 });

    render(<Display expression="" value="56" isLoading={false} />);

    expect(screen.getByTestId('display-value').style.fontSize).toBe('');
  });
});
