import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { calculate, fetchOperations } from './client';

/** Builds a Response-like stub, since jsdom has no real network. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('calculate', () => {
  it('returns the parsed result on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { operation: 'add', operands: { a: 2, b: 3 }, result: 5 }),
    );

    const outcome = await calculate('add', 2, 3);

    expect(outcome).toEqual({
      ok: true,
      data: { operation: 'add', operands: { a: 2, b: 3 }, result: 5 },
    });
  });

  it('posts the operation in the path and the operands in the body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { operation: 'divide', operands: { a: 10, b: 4 }, result: 2.5 }),
    );

    await calculate('divide', 10, 4);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/v1/operations/divide');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ a: 10, b: 4 });
  });

  // The API rejects a second operand on a unary operation, so it must be
  // omitted entirely rather than sent as null or zero.
  it('omits the second operand for unary operations', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { operation: 'sqrt', operands: { a: 81 }, result: 9 }),
    );

    await calculate('sqrt', 81);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ a: 81 });
    expect('b' in body).toBe(false);
  });

  it('sends an explicit zero operand rather than dropping it', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(400, { error: { code: 'division_by_zero', message: 'cannot divide by zero' } }),
    );

    await calculate('divide', 10, 0);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ a: 10, b: 0 });
  });

  it('surfaces the API error envelope on a 4xx', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(400, { error: { code: 'division_by_zero', message: 'cannot divide by zero' } }),
    );

    const outcome = await calculate('divide', 10, 0);

    expect(outcome).toEqual({
      ok: false,
      error: { code: 'division_by_zero', message: 'cannot divide by zero' },
    });
  });

  it('carries the supported operations list from a 404', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, {
        error: {
          code: 'unsupported_operation',
          message: 'unsupported operation',
          supported_operations: ['add', 'divide'],
        },
      }),
    );

    const outcome = await calculate('add', 1, 2);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.supportedOperations).toEqual(['add', 'divide']);
    }
  });

  it('reports a friendly message when the backend is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    const outcome = await calculate('add', 1, 2);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('network_error');
      expect(outcome.error.message).toMatch(/backend/i);
    }
  });

  it('distinguishes a timeout from a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    const outcome = await calculate('add', 1, 2);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('timeout');
    }
  });

  // A proxy or gateway can return HTML rather than the documented envelope;
  // the client must not crash trying to read .error.message off it.
  it('handles a non-JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);

    const outcome = await calculate('add', 1, 2);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('malformed_response');
    }
  });

  it('rejects an error body that is not the documented shape', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, { oops: true }));

    const outcome = await calculate('add', 1, 2);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('malformed_response');
    }
  });

  it('rejects a success body with no numeric result', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { operation: 'add', result: 'five' }));

    const outcome = await calculate('add', 2, 3);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('malformed_response');
    }
  });

  // Infinity cannot appear in JSON, but a hand-rolled backend could emit it;
  // treating it as valid would put "Infinity" on the display.
  it('rejects a non-finite result', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { operation: 'divide', result: Number.POSITIVE_INFINITY }),
    );

    const outcome = await calculate('divide', 1, 0);

    expect(outcome.ok).toBe(false);
  });

  it('defaults the code when the error body omits it', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(400, { error: { message: 'something broke' } }));

    const outcome = await calculate('add', 1, 2);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toEqual({ code: 'unknown_error', message: 'something broke' });
    }
  });
});

describe('fetchOperations', () => {
  it('returns the advertised operation names', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        operations: [
          { operation: 'add', arity: 2 },
          { operation: 'sqrt', arity: 1 },
        ],
      }),
    );

    await expect(fetchOperations()).resolves.toEqual(['add', 'sqrt']);
  });

  it('returns null when the service is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchOperations()).resolves.toBeNull();
  });

  it('returns null on an error status', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, {}));

    await expect(fetchOperations()).resolves.toBeNull();
  });

  it('returns null when the payload is not the documented shape', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { operations: 'nope' }));

    await expect(fetchOperations()).resolves.toBeNull();
  });
});
