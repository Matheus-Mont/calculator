/**
 * Session-unique ids for history entries.
 *
 * These are React keys and nothing more: never persisted, never sent anywhere,
 * never compared across sessions. `crypto.randomUUID()` would produce them, but
 * it is exposed only in secure contexts — so on an HTTP deployment reached by
 * hostname or IP (which is how a container normally gets reached) it is
 * `undefined`, and every successful calculation throws a TypeError that leaves
 * the keypad stuck in its loading state. A counter has no such dependency.
 */
let counter = 0;

export function nextHistoryId(): string {
  counter += 1;
  return `history-${counter}`;
}
