import type { ApiError, Calculation, Operation } from '../types';

/**
 * Base URL of the calculator API.
 *
 * The default is a relative path so the browser always talks to its own origin:
 * Vite proxies it in development and nginx proxies it in the Docker image. Set
 * VITE_API_BASE_URL to point at a backend on a different host.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** How long to wait before giving up on a request. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The outcome of a calculation.
 *
 * A discriminated union rather than a thrown exception: a rejected calculation
 * (dividing by zero) is an expected result the UI must render, not an
 * exceptional condition, and this forces callers to handle both branches.
 */
export type CalculateOutcome =
  | { ok: true; data: Calculation }
  | { ok: false; error: ApiError };

/** Error surfaced when the API cannot be reached at all. */
const NETWORK_ERROR: ApiError = {
  code: 'network_error',
  message: 'Could not reach the calculator service. Is the backend running?',
};

const TIMEOUT_ERROR: ApiError = {
  code: 'timeout',
  message: 'The calculator service took too long to respond.',
};

const MALFORMED_RESPONSE_ERROR: ApiError = {
  code: 'malformed_response',
  message: 'The calculator service returned an unexpected response.',
};

/**
 * Sends one operation to the backend.
 *
 * `b` is omitted for unary operations such as sqrt; the API rejects a second
 * operand there, so it must not be sent as null or zero.
 */
export async function calculate(
  operation: Operation,
  a: number,
  b?: number,
): Promise<CalculateOutcome> {
  const body: { a: number; b?: number } = b === undefined ? { a } : { a, b };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/operations/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // fetch rejects only on network failure or abort; HTTP error statuses
    // resolve normally and are handled below.
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    return { ok: false, error: isTimeout ? TIMEOUT_ERROR : NETWORK_ERROR };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: MALFORMED_RESPONSE_ERROR };
  }

  if (!response.ok) {
    return { ok: false, error: parseApiError(payload) };
  }

  if (!isCalculation(payload)) {
    return { ok: false, error: MALFORMED_RESPONSE_ERROR };
  }

  return { ok: true, data: payload };
}

/** Fetches the operations the backend advertises. Used to verify connectivity. */
export async function fetchOperations(): Promise<Operation[] | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/operations`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !Array.isArray((payload as { operations?: unknown }).operations)
    ) {
      return null;
    }

    return (payload as { operations: { operation: Operation }[] }).operations.map(
      (entry) => entry.operation,
    );
  } catch {
    return null;
  }
}

/**
 * Extracts the API's error envelope, falling back to a generic message when the
 * body is not the documented shape (e.g. a proxy returned an HTML error page).
 */
function parseApiError(payload: unknown): ApiError {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return MALFORMED_RESPONSE_ERROR;
  }

  const detail = (payload as { error: unknown }).error;
  if (
    typeof detail !== 'object' ||
    detail === null ||
    typeof (detail as { message?: unknown }).message !== 'string'
  ) {
    return MALFORMED_RESPONSE_ERROR;
  }

  const { code, message, supported_operations: supported } = detail as {
    code?: unknown;
    message: string;
    supported_operations?: unknown;
  };

  return {
    code: typeof code === 'string' ? code : 'unknown_error',
    message,
    ...(Array.isArray(supported) ? { supportedOperations: supported as string[] } : {}),
  };
}

function isCalculation(payload: unknown): payload is Calculation {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { result?: unknown }).result === 'number' &&
    Number.isFinite((payload as { result: number }).result)
  );
}
