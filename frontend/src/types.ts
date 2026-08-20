/** Operations supported by the backend, matching the API's path segment. */
export const BINARY_OPERATIONS = ['add', 'subtract', 'multiply', 'divide', 'power', 'percentage'] as const;
export const UNARY_OPERATIONS = ['sqrt'] as const;

export type BinaryOperation = (typeof BINARY_OPERATIONS)[number];
export type UnaryOperation = (typeof UNARY_OPERATIONS)[number];
export type Operation = BinaryOperation | UnaryOperation;

/** Symbol shown on the keypad and in history for each operation. */
export const OPERATION_SYMBOLS: Record<Operation, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
  power: '^',
  percentage: '%',
  sqrt: '√',
};

/** A successful calculation, as returned by the API. */
export interface Calculation {
  operation: Operation;
  operands: { a: number; b?: number };
  result: number;
}

/** The API's error envelope. */
export interface ApiError {
  code: string;
  message: string;
  supportedOperations?: string[];
}

/** One entry in the on-screen history list. */
export interface HistoryEntry {
  id: string;
  expression: string;
  result: string;
}
