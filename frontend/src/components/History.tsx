import type { HistoryEntry } from '../types';

interface HistoryProps {
  entries: HistoryEntry[];
  onClear: () => void;
}

/** A running log of calculations the backend has performed this session. */
export function History({ entries, onClear }: HistoryProps) {
  return (
    <section className="history" aria-labelledby="history-heading">
      <header className="history__header">
        <h2 className="history__title" id="history-heading">
          History
        </h2>
        <button
          type="button"
          className="history__clear"
          onClick={onClear}
          disabled={entries.length === 0}
        >
          Clear
        </button>
      </header>

      {entries.length === 0 ? (
        <p className="history__empty">Calculations you run will appear here.</p>
      ) : (
        <ol className="history__list">
          {entries.map((entry) => (
            <li key={entry.id} className="history__item">
              <span className="history__expression">{entry.expression}</span>
              <span className="history__result">= {entry.result}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
