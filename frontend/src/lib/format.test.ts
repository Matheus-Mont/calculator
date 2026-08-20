import { describe, expect, it } from 'vitest';

import { formatEntry, formatNumber } from './format';

describe('formatNumber', () => {
  it('shows integers without a decimal part', () => {
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-7)).toBe('-7');
  });

  it('keeps genuine decimals', () => {
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(-0.125)).toBe('-0.125');
  });

  // The whole reason this function exists: the API returns raw IEEE-754
  // doubles, and 0.1 + 0.2 really does come back as 0.30000000000000004.
  it('trims binary floating-point noise', () => {
    expect(formatNumber(0.30000000000000004)).toBe('0.3');
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(2.675 * 100)).toBe('267.5');
  });

  it('keeps twelve significant digits of a repeating decimal', () => {
    expect(formatNumber(1 / 3)).toBe('0.333333333333');
  });

  it('renders very large numbers without losing them', () => {
    expect(formatNumber(1e21)).toBe('1e+21');
    expect(formatNumber(123456789)).toBe('123456789');
  });

  it('renders very small numbers in exponential form', () => {
    expect(formatNumber(1e-9)).toBe('1e-9');
  });

  // A non-finite value should never reach the display, but if one does the UI
  // must not print "Infinity" or "NaN" as though it were a result.
  it('refuses to display non-finite values', () => {
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('Error');
    expect(formatNumber(Number.NaN)).toBe('Error');
  });
});

describe('formatEntry', () => {
  it('shows zero for an empty entry', () => {
    expect(formatEntry('')).toBe('0');
  });

  // A partial entry must survive verbatim, or the decimal point would vanish
  // the moment it is typed.
  it('preserves a trailing decimal point while typing', () => {
    expect(formatEntry('3.')).toBe('3.');
    expect(formatEntry('0.000')).toBe('0.000');
    expect(formatEntry('-')).toBe('-');
  });
});
