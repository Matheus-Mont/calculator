import { useCallback, useReducer, useRef } from 'react';

import { calculate as defaultCalculate } from '../api/client';
import type { CalculateOutcome } from '../api/client';
import { formatEntry, formatNumber } from '../lib/format';
import { nextHistoryId } from '../lib/id';
import { OPERATION_SYMBOLS } from '../types';
import type { BinaryOperation, HistoryEntry, Operation, UnaryOperation } from '../types';

/** Longest number a user may type, to keep the display readable. */
const MAX_ENTRY_LENGTH = 16;

/** How many past calculations to keep. */
const MAX_HISTORY_ENTRIES = 20;

interface CalculatorState {
  /** Digits currently being typed. Empty means nothing typed since the last action. */
  entry: string;
  /** The left-hand operand awaiting an operation. */
  accumulator: number | null;
  /** The operation waiting for its right-hand operand. */
  pendingOp: BinaryOperation | null;
  /** True right after "=", so the next digit starts a fresh number. */
  justEvaluated: boolean;
  history: HistoryEntry[];
  error: string | null;
  isLoading: boolean;
}

const initialState: CalculatorState = {
  entry: '',
  accumulator: null,
  pendingOp: null,
  justEvaluated: false,
  history: [],
  error: null,
  isLoading: false,
};

type Action =
  | { type: 'INPUT_DIGIT'; digit: string }
  | { type: 'INPUT_DECIMAL' }
  | { type: 'TOGGLE_SIGN' }
  | { type: 'BACKSPACE' }
  | { type: 'CLEAR_ALL' }
  | { type: 'SET_PENDING_OP'; op: BinaryOperation }
  | { type: 'REQUEST_START' }
  | { type: 'REQUEST_SUCCESS'; id: string; result: number; expression: string; nextOp: BinaryOperation | null }
  | { type: 'UNARY_SUCCESS'; id: string; result: number; expression: string }
  | { type: 'REQUEST_FAILURE'; message: string }
  | { type: 'CLEAR_HISTORY' };

/**
 * Pure state transition.
 *
 * Every value it needs arrives on the action — history ids included. React may
 * call a reducer more than once for the same action (StrictMode does so
 * deliberately in development), so minting an id in here would make the same
 * dispatch produce different states.
 */
function reducer(state: CalculatorState, action: Action): CalculatorState {
  switch (action.type) {
    case 'INPUT_DIGIT': {
      // A digit after "=" begins a new calculation rather than appending to
      // the previous result.
      const base = state.justEvaluated ? '' : state.entry;
      if (base.length >= MAX_ENTRY_LENGTH) return state;

      // Avoid leading zeros like "007", while leaving "0.5" intact.
      const entry = base === '0' ? action.digit : base + action.digit;
      return { ...state, entry, justEvaluated: false, error: null };
    }

    case 'INPUT_DECIMAL': {
      const base = state.justEvaluated ? '' : state.entry;
      if (base.includes('.')) return state;
      if (base.length >= MAX_ENTRY_LENGTH) return state;

      // A bare "." is ambiguous, so start from "0.".
      return { ...state, entry: base === '' ? '0.' : `${base}.`, justEvaluated: false, error: null };
    }

    case 'TOGGLE_SIGN': {
      // With nothing typed, flip the accumulator so "5 + = " style sequences
      // and a negated result both behave.
      if (state.entry === '') {
        if (state.accumulator === null) return state;
        return { ...state, accumulator: -state.accumulator, error: null };
      }
      const entry = state.entry.startsWith('-') ? state.entry.slice(1) : `-${state.entry}`;
      return { ...state, entry, error: null };
    }

    case 'BACKSPACE': {
      if (state.justEvaluated || state.entry === '') return state;
      // Dropping the last character of "-5" leaves "-", which is not a number;
      // collapse it to empty instead.
      const entry = state.entry.slice(0, -1);
      return { ...state, entry: entry === '-' ? '' : entry, error: null };
    }

    case 'CLEAR_ALL':
      // History survives a clear: it is a record, not part of the calculation.
      return { ...initialState, history: state.history };

    case 'SET_PENDING_OP': {
      const accumulator = state.entry === '' ? state.accumulator : Number(state.entry);
      if (accumulator === null) return state;
      return {
        ...state,
        accumulator,
        pendingOp: action.op,
        entry: '',
        justEvaluated: false,
        error: null,
      };
    }

    case 'REQUEST_START':
      return { ...state, isLoading: true, error: null };

    case 'REQUEST_SUCCESS':
      return {
        ...state,
        isLoading: false,
        error: null,
        accumulator: action.result,
        entry: '',
        pendingOp: action.nextOp,
        justEvaluated: action.nextOp === null,
        history: [
          { id: action.id, expression: action.expression, result: formatNumber(action.result) },
          ...state.history,
        ].slice(0, MAX_HISTORY_ENTRIES),
      };

    case 'UNARY_SUCCESS': {
      const entry = {
        id: action.id,
        expression: action.expression,
        result: formatNumber(action.result),
      };
      const history = [entry, ...state.history].slice(0, MAX_HISTORY_ENTRIES);

      // With a binary operation pending, the unary result becomes its
      // right-hand operand rather than a final answer, so "9 + √16 =" is 13.
      // Storing the formatted string keeps the displayed value and the value
      // actually sent to the API identical.
      if (state.pendingOp !== null) {
        return { ...state, isLoading: false, error: null, entry: formatNumber(action.result), history };
      }

      return {
        ...state,
        isLoading: false,
        error: null,
        accumulator: action.result,
        entry: '',
        justEvaluated: true,
        history,
      };
    }

    case 'REQUEST_FAILURE':
      // The operands are deliberately left in place: after "10 ÷ 0 =" the user
      // can press backspace and type a new divisor rather than start over.
      return { ...state, isLoading: false, error: action.message };

    case 'CLEAR_HISTORY':
      return { ...state, history: [] };

    default:
      return state;
  }
}

/** What the display shows: the live entry if typing, otherwise the last value. */
function displayValue(state: CalculatorState): string {
  if (state.entry !== '') return formatEntry(state.entry);
  if (state.accumulator !== null) return formatNumber(state.accumulator);
  return '0';
}

/** The expression line above the display, e.g. "12 ÷". */
function displayExpression(state: CalculatorState): string {
  if (state.accumulator === null || state.pendingOp === null) return '';
  return `${formatNumber(state.accumulator)} ${OPERATION_SYMBOLS[state.pendingOp]}`;
}

export interface UseCalculatorOptions {
  /** Injectable API call, so tests can drive the hook without a network. */
  calculate?: (operation: Operation, a: number, b?: number) => Promise<CalculateOutcome>;
}

/**
 * Owns all calculator behaviour: keypad state, when to call the API, and how to
 * surface results and errors.
 *
 * Digits are accumulated locally, but every arithmetic result comes from the
 * backend — pressing "=" or chaining a second operator flushes the pending
 * operation over HTTP.
 */
export function useCalculator(options: UseCalculatorOptions = {}) {
  const calculate = options.calculate ?? defaultCalculate;
  const [state, dispatch] = useReducer(reducer, initialState);

  // Async callbacks would otherwise close over the state of the render that
  // created them; this ref always holds the latest.
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Whether a request is already in flight.
   *
   * Deliberately a ref rather than `state.isLoading`: dispatching REQUEST_START
   * does not update state until the next render, so two calls in the same tick
   * would both read `isLoading: false` and both fire. Holding Enter down used to
   * send one request per keypress and write a history entry for each.
   */
  const inFlightRef = useRef(false);

  /**
   * Sends the pending binary operation to the API.
   *
   * `nextOp` is what should be left pending afterwards: null for "=", or the
   * newly pressed operator when chaining (12 ÷ 4 + …).
   */
  const flushPending = useCallback(
    async (nextOp: BinaryOperation | null) => {
      const current = stateRef.current;
      const { accumulator, pendingOp, entry } = current;

      if (accumulator === null || pendingOp === null) return;
      // Nothing typed for the right-hand side: repeat the left operand, which
      // is what physical calculators do for "5 + =".
      const b = entry === '' ? accumulator : Number(entry);
      if (!Number.isFinite(b)) return;

      const expression = `${formatNumber(accumulator)} ${OPERATION_SYMBOLS[pendingOp]} ${formatNumber(b)}`;

      if (inFlightRef.current) return;
      inFlightRef.current = true;

      dispatch({ type: 'REQUEST_START' });
      const outcome = await calculate(pendingOp, accumulator, b).finally(() => {
        inFlightRef.current = false;
      });

      if (outcome.ok) {
        dispatch({
          type: 'REQUEST_SUCCESS',
          id: nextHistoryId(),
          result: outcome.data.result,
          expression,
          nextOp,
        });
      } else {
        dispatch({ type: 'REQUEST_FAILURE', message: outcome.error.message });
      }
    },
    [calculate],
  );

  const inputDigit = useCallback((digit: string) => {
    dispatch({ type: 'INPUT_DIGIT', digit });
  }, []);

  const inputDecimal = useCallback(() => dispatch({ type: 'INPUT_DECIMAL' }), []);
  const toggleSign = useCallback(() => dispatch({ type: 'TOGGLE_SIGN' }), []);
  const backspace = useCallback(() => dispatch({ type: 'BACKSPACE' }), []);
  const clearAll = useCallback(() => dispatch({ type: 'CLEAR_ALL' }), []);
  const clearHistory = useCallback(() => dispatch({ type: 'CLEAR_HISTORY' }), []);

  /**
   * Handles an operator key. If an operation is already pending and the user
   * has supplied its right-hand operand, that one is evaluated first so
   * "12 ÷ 4 + 5" chains the way a physical calculator does.
   */
  const chooseOperation = useCallback(
    async (op: BinaryOperation) => {
      const { pendingOp, accumulator, entry } = stateRef.current;

      if (pendingOp !== null && accumulator !== null && entry !== '') {
        await flushPending(op);
        return;
      }
      dispatch({ type: 'SET_PENDING_OP', op });
    },
    [flushPending],
  );

  /** Applies a unary operation (sqrt) to the displayed value immediately. */
  const applyUnary = useCallback(
    async (op: UnaryOperation) => {
      const { entry, accumulator } = stateRef.current;
      const a = entry === '' ? accumulator : Number(entry);
      if (a === null || !Number.isFinite(a)) return;

      const expression = `${OPERATION_SYMBOLS[op]}(${formatNumber(a)})`;

      if (inFlightRef.current) return;
      inFlightRef.current = true;

      dispatch({ type: 'REQUEST_START' });
      const outcome = await calculate(op, a).finally(() => {
        inFlightRef.current = false;
      });

      if (outcome.ok) {
        dispatch({
          type: 'UNARY_SUCCESS',
          id: nextHistoryId(),
          result: outcome.data.result,
          expression,
        });
      } else {
        dispatch({ type: 'REQUEST_FAILURE', message: outcome.error.message });
      }
    },
    [calculate],
  );

  const evaluate = useCallback(async () => {
    if (stateRef.current.pendingOp === null) return;
    await flushPending(null);
  }, [flushPending]);

  return {
    display: displayValue(state),
    expression: displayExpression(state),
    history: state.history,
    error: state.error,
    isLoading: state.isLoading,
    inputDigit,
    inputDecimal,
    toggleSign,
    backspace,
    clearAll,
    clearHistory,
    chooseOperation,
    applyUnary,
    evaluate,
  };
}
