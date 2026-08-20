import { useEffect, useRef } from 'react';

import type { BinaryOperation, UnaryOperation } from '../types';

interface KeyboardHandlers {
  onDigit: (digit: string) => void;
  onDecimal: () => void;
  onOperation: (op: BinaryOperation) => void;
  onUnary: (op: UnaryOperation) => void;
  onEquals: () => void;
  onClear: () => void;
  onBackspace: () => void;
}

/** Physical keys mapped to binary operations. */
const OPERATION_KEYS: Record<string, BinaryOperation> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
  '^': 'power',
  '%': 'percentage',
};

/**
 * Binds the physical keyboard to the calculator.
 *
 * Typing is how most people use a calculator on a desktop, and it costs little
 * given the keypad handlers already exist.
 */
export function useKeyboard(handlers: KeyboardHandlers): void {
  // The caller passes a fresh object every render. Reading through a ref binds
  // the listener once instead of tearing it down and re-adding it each time.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Let the browser handle shortcuts like Ctrl+R untouched.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const { key } = event;
      const on = handlersRef.current;

      if (key >= '0' && key <= '9') {
        on.onDigit(key);
      } else if (key === '.' || key === ',') {
        on.onDecimal();
      } else if (key in OPERATION_KEYS) {
        // Non-null assertion is safe: the `in` check just proved the key exists.
        on.onOperation(OPERATION_KEYS[key]!);
      } else if (key === 'Enter' || key === '=') {
        // Enter would otherwise re-trigger the focused button as well.
        event.preventDefault();
        on.onEquals();
      } else if (key === 'Backspace') {
        on.onBackspace();
      } else if (key === 'Escape') {
        on.onClear();
      } else if (key === 'r' || key === 'R') {
        on.onUnary('sqrt');
      } else {
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
