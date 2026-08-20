import { Key } from './Key';
import type { BinaryOperation, UnaryOperation } from '../types';

interface KeypadProps {
  disabled: boolean;
  onDigit: (digit: string) => void;
  onDecimal: () => void;
  onOperation: (op: BinaryOperation) => void;
  onUnary: (op: UnaryOperation) => void;
  onEquals: () => void;
  onClear: () => void;
  onBackspace: () => void;
  onToggleSign: () => void;
}

/**
 * The button grid.
 *
 * Layout is a 4-column CSS grid; the keys are declared in visual order so the
 * DOM order a keyboard user tabs through matches what they see.
 */
export function Keypad({
  disabled,
  onDigit,
  onDecimal,
  onOperation,
  onUnary,
  onEquals,
  onClear,
  onBackspace,
  onToggleSign,
}: KeypadProps) {
  return (
    <div className="keypad" role="group" aria-label="Calculator keypad">
      <Key label="AC" ariaLabel="Clear all" variant="function" onClick={onClear} />
      <Key label="⌫" ariaLabel="Backspace" variant="function" onClick={onBackspace} />
      <Key label="√" ariaLabel="Square root" variant="function" disabled={disabled} onClick={() => onUnary('sqrt')} />
      <Key label="÷" ariaLabel="Divide" variant="operator" disabled={disabled} onClick={() => onOperation('divide')} />

      <Key label="7" disabled={disabled} onClick={() => onDigit('7')} />
      <Key label="8" disabled={disabled} onClick={() => onDigit('8')} />
      <Key label="9" disabled={disabled} onClick={() => onDigit('9')} />
      <Key label="×" ariaLabel="Multiply" variant="operator" disabled={disabled} onClick={() => onOperation('multiply')} />

      <Key label="4" disabled={disabled} onClick={() => onDigit('4')} />
      <Key label="5" disabled={disabled} onClick={() => onDigit('5')} />
      <Key label="6" disabled={disabled} onClick={() => onDigit('6')} />
      <Key label="−" ariaLabel="Subtract" variant="operator" disabled={disabled} onClick={() => onOperation('subtract')} />

      <Key label="1" disabled={disabled} onClick={() => onDigit('1')} />
      <Key label="2" disabled={disabled} onClick={() => onDigit('2')} />
      <Key label="3" disabled={disabled} onClick={() => onDigit('3')} />
      <Key label="+" ariaLabel="Add" variant="operator" disabled={disabled} onClick={() => onOperation('add')} />

      <Key label="±" ariaLabel="Toggle sign" variant="function" onClick={onToggleSign} />
      <Key label="0" disabled={disabled} onClick={() => onDigit('0')} />
      <Key label="." ariaLabel="Decimal point" disabled={disabled} onClick={onDecimal} />
      <Key label="=" ariaLabel="Equals" variant="equals" disabled={disabled} onClick={onEquals} />

      <Key label="xʸ" ariaLabel="Power" variant="operator" wide disabled={disabled} onClick={() => onOperation('power')} />
      <Key label="%" ariaLabel="Percentage" variant="operator" wide disabled={disabled} onClick={() => onOperation('percentage')} />
    </div>
  );
}
