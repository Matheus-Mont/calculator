import { useId, useState } from 'react';

import type { HistoryEntry } from '../types';

interface HistoryProps {
  entries: HistoryEntry[];
  onClear: () => void;
}

/**
 * A running log of calculations the backend has performed this session.
 *
 * Collapsed to the most recent result by default: the last answer is the one
 * worth glancing at while calculating, and a full list below the keypad would
 * push the calculator around as it grows. The rest stay one click away.
 */
export function History({ entries, onClear }: HistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const hasEntries = entries.length > 0;
  const hiddenCount = Math.max(entries.length - 1, 0);
  // Collapsing is only meaningful once something is actually hidden.
  const isExpanded = expanded && hiddenCount > 0;
  const visible = isExpanded ? entries : entries.slice(0, 1);

  return (
    <section className="history" aria-labelledby="history-heading">
      <header className="history__header">
        <h2 className="history__title" id="history-heading">
          History
        </h2>
        {hasEntries && (
          <button type="button" className="history__clear" onClick={onClear}>
            Clear
          </button>
        )}
      </header>

      {!hasEntries ? (
        <p className="history__empty">Calculations you run will appear here.</p>
      ) : (
        <>
          <ol
            className={`history__list${isExpanded ? ' history__list--expanded' : ''}`}
            id={listId}
          >
            {visible.map((entry) => (
              <li key={entry.id} className="history__item">
                <span className="history__expression">{entry.expression}</span>
                <span className="history__result">= {entry.result}</span>
              </li>
            ))}
          </ol>

          {hiddenCount > 0 && (
            <button
              type="button"
              className="history__toggle"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={isExpanded}
              aria-controls={listId}
            >
              {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
