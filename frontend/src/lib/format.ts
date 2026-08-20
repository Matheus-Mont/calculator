/**
 * Maximum significant digits shown on screen.
 *
 * The API returns raw IEEE-754 doubles, so 0.1 + 0.2 really is
 * 0.30000000000000004. Rounding to 12 significant digits hides that artefact
 * while staying well short of the ~15-17 digits a double actually carries, so
 * no meaningful precision is lost in the range a calculator is used for.
 */
const DISPLAY_PRECISION = 12;

/** Formats a number for display, trimming floating-point noise. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'Error';
  }

  // Integers are shown verbatim, so 42 never renders as "42.0000000000".
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return String(value);
  }

  // Round-tripping through toPrecision collapses the trailing 9s and 0s that
  // are artefacts of binary representation; String() then drops the padding
  // zeros toPrecision itself introduces.
  return String(Number(value.toPrecision(DISPLAY_PRECISION)));
}

/**
 * Formats what the user is currently typing.
 *
 * Unlike a computed result, a partial entry must be shown exactly as typed:
 * "3." has to stay "3." while the user is mid-number, and "0.000" must not
 * collapse to "0".
 */
export function formatEntry(entry: string): string {
  return entry === '' ? '0' : entry;
}
