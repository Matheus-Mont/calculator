import { memo } from 'react';

export type KeyVariant = 'digit' | 'operator' | 'function' | 'equals';

interface KeyProps {
  /** Glyph shown on the key. */
  label: string;
  /**
   * Spoken label. Required whenever the glyph is a symbol: a screen reader
   * announcing "÷" as "division sign" is far less clear than "divide".
   */
  ariaLabel?: string;
  variant?: KeyVariant;
  /** Spans two grid columns, used by the zero key. */
  wide?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export const Key = memo(function Key({
  label,
  ariaLabel,
  variant = 'digit',
  wide = false,
  disabled = false,
  onClick,
}: KeyProps) {
  return (
    <button
      type="button"
      className={`key key--${variant}${wide ? ' key--wide' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
    >
      {label}
    </button>
  );
});
