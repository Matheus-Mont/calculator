import { Display } from './components/Display';
import { ErrorBanner } from './components/ErrorBanner';
import { History } from './components/History';
import { Keypad } from './components/Keypad';
import { useCalculator } from './hooks/useCalculator';
import type { UseCalculatorOptions } from './hooks/useCalculator';
import { useKeyboard } from './hooks/useKeyboard';

/**
 * Options exist purely so tests can inject a stub API client; the app itself
 * always uses the real one.
 */
export function App({ calculatorOptions }: { calculatorOptions?: UseCalculatorOptions }) {
  const calculator = useCalculator(calculatorOptions ?? {});

  useKeyboard({
    onDigit: calculator.inputDigit,
    onDecimal: calculator.inputDecimal,
    onOperation: calculator.chooseOperation,
    onUnary: calculator.applyUnary,
    onEquals: calculator.evaluate,
    onClear: calculator.clearAll,
    onBackspace: calculator.backspace,
  });

  return (
    <main className="app">
      <div className="app__inner">
        <header className="app__header">
          <h1 className="app__title">Calculator</h1>
          <p className="app__subtitle">Every result is computed by the Go API.</p>
        </header>

        <div className="app__panels">
          <section className="calculator" aria-label="Calculator">
            <Display
              expression={calculator.expression}
              value={calculator.display}
              isLoading={calculator.isLoading}
            />

            <ErrorBanner message={calculator.error} onDismiss={calculator.clearAll} />

            <Keypad
              // Blocking input while a request is in flight keeps the local
              // keypad state and the server's answer from interleaving.
              disabled={calculator.isLoading}
              onDigit={calculator.inputDigit}
              onDecimal={calculator.inputDecimal}
              onOperation={calculator.chooseOperation}
              onUnary={calculator.applyUnary}
              onEquals={calculator.evaluate}
              onClear={calculator.clearAll}
              onBackspace={calculator.backspace}
              onToggleSign={calculator.toggleSign}
            />
          </section>

          <History entries={calculator.history} onClear={calculator.clearHistory} />
        </div>

        <footer className="app__footer">
          <p>
            Keyboard: digits, <kbd>+</kbd> <kbd>-</kbd> <kbd>*</kbd> <kbd>/</kbd> <kbd>^</kbd>{' '}
            <kbd>%</kbd>, <kbd>R</kbd> for √, <kbd>Enter</kbd> to evaluate, <kbd>Esc</kbd> to clear.
          </p>
        </footer>
      </div>
    </main>
  );
}
