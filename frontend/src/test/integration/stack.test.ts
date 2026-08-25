import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { calculate, fetchOperations } from '../../api/client';

/**
 * End-to-end across the real boundary: the actual Go binary, behind the actual
 * Vite proxy, called through the actual API client with an unmocked fetch.
 *
 * This is the layer the unit tests cannot reach. They stub `fetch`, so no unit
 * test ever sees a proxy — which is exactly how the client came to report a
 * stopped backend as "an unexpected response" instead of an unreachable one.
 */

/** Supplied by vitest.integration.config.ts, so this file imports nothing from it. */
function requiredPort(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be set; run this suite via vitest.integration.config.ts`);
  }
  return value;
}

const INTEGRATION_BACKEND_PORT = requiredPort('INTEGRATION_BACKEND_PORT');
const INTEGRATION_PROXY_PORT = requiredPort('INTEGRATION_PROXY_PORT');

const REPO_ROOT = resolve(__dirname, '../../../..');
const BACKEND_DIR = join(REPO_ROOT, 'backend');

let backend: ChildProcess | null = null;
let vite: ViteDevServer;

/**
 * Everything the server process wrote.
 *
 * Captured rather than discarded so a failure to start reports why. Swallowing
 * it leaves only "backend never became reachable", which says nothing useful in
 * a CI log.
 */
let backendOutput = '';

/**
 * Resolves the server binary.
 *
 * CI builds it once in the Go job and passes the path in, so the Node job needs
 * no Go toolchain. Locally it is compiled on demand.
 */
function resolveBackendBinary(): string {
  const prebuilt = process.env.CALCULATOR_BACKEND_BIN;
  if (prebuilt) {
    const path = resolve(REPO_ROOT, prebuilt);
    if (!existsSync(path)) {
      throw new Error(`CALCULATOR_BACKEND_BIN points at a missing file: ${path}`);
    }
    const { size, mode } = statSync(path);
    console.info(`using prebuilt backend: ${path} (${size} bytes, mode ${(mode & 0o777).toString(8)})`);
    return path;
  }

  const go = [
    'go',
    join(process.env.HOME ?? '', '.local/go/bin/go'),
    '/usr/local/go/bin/go',
  ].find((candidate) => {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });

  if (!go) {
    throw new Error(
      'Go is required for the integration tests. Install it, or build the ' +
        'server and point CALCULATOR_BACKEND_BIN at the binary.',
    );
  }

  const out = join(mkdtempSync(join(tmpdir(), 'calc-int-')), 'server');
  execFileSync(go, ['build', '-o', out, './cmd/server'], { cwd: BACKEND_DIR, stdio: 'pipe' });
  return out;
}

function startBackend(binary: string): ChildProcess {
  // CI artifacts do not reliably preserve the executable bit, and a binary that
  // cannot be executed would otherwise surface only as a timeout.
  try {
    chmodSync(binary, 0o755);
  } catch {
    // Already executable, or not ours to change; spawn will report the truth.
  }

  backendOutput = '';
  const child = spawn(binary, [], {
    env: { ...process.env, PORT: String(INTEGRATION_BACKEND_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    backendOutput += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    backendOutput += chunk.toString();
  });
  child.on('error', (error) => {
    backendOutput += `failed to spawn: ${error.message}\n`;
  });
  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) backendOutput += `exited with status ${code}\n`;
    if (signal !== null) backendOutput += `terminated by ${signal}\n`;
  });

  return child;
}

/** Polls until the server answers, so tests never race the boot. */
async function waitForBackend(up: boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // A process that has already exited is never going to answer; failing now
    // reports the reason instead of waiting out the timeout.
    if (up && backend !== null && backend.exitCode !== null) {
      throw new Error(
        `backend exited before it became reachable\n--- server output ---\n${backendOutput || '(none)'}`,
      );
    }
    let healthy = false;
    try {
      const response = await fetch(`http://127.0.0.1:${INTEGRATION_BACKEND_PORT}/healthz`);
      healthy = response.ok;
    } catch {
      healthy = false;
    }
    if (healthy === up) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `backend never became ${up ? 'reachable' : 'unreachable'} within ${timeoutMs}ms` +
      `\n--- server output ---\n${backendOutput || '(none)'}`,
  );
}

async function stopBackend(): Promise<void> {
  if (!backend) return;
  const exited = new Promise<void>((r) => backend?.once('exit', () => r()));
  backend.kill('SIGKILL');
  await exited;
  backend = null;
  await waitForBackend(false);
}

beforeAll(async () => {
  const binary = resolveBackendBinary();
  backend = startBackend(binary);
  await waitForBackend(true);

  // The real proxy configuration, loaded from the project's own vite.config.ts.
  vite = await createServer({
    root: resolve(__dirname, '../../..'),
    configFile: resolve(__dirname, '../../../vite.config.ts'),
    server: {
      port: INTEGRATION_PROXY_PORT,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${INTEGRATION_BACKEND_PORT}`,
          changeOrigin: true,
        },
      },
    },
    logLevel: 'silent',
  });
  await vite.listen();
});

afterAll(async () => {
  await vite?.close();
  await stopBackend().catch(() => {});
});

describe('calculating through the real stack', () => {
  it.each([
    ['add', 2, 3, 5],
    ['subtract', 10, 4, 6],
    ['multiply', 6, 7, 42],
    ['divide', 10, 4, 2.5],
    ['power', 2, 10, 1024],
    ['percentage', 20, 50, 10],
  ] as const)('computes %s', async (operation, a, b, expected) => {
    const outcome = await calculate(operation, a, b);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.data.result).toBe(expected);
  });

  it('computes a unary operation without sending a second operand', async () => {
    const outcome = await calculate('sqrt', 81);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data.result).toBe(9);
      expect(outcome.data.operands.b).toBeUndefined();
    }
  });

  // The README documents this exact value; the unit tests only assert the
  // formatting of it, never that the server really returns it.
  it('returns the raw IEEE-754 sum for 0.1 + 0.2', async () => {
    const outcome = await calculate('add', 0.1, 0.2);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.data.result).toBe(0.30000000000000004);
  });

  it('discovers the operations the server advertises', async () => {
    await expect(fetchOperations()).resolves.toEqual([
      'add', 'divide', 'multiply', 'percentage', 'power', 'sqrt', 'subtract',
    ]);
  });
});

describe('real error envelopes reach the client', () => {
  it.each([
    ['divide', 10, 0, 'division_by_zero'],
    ['sqrt', -9, undefined, 'negative_square_root'],
    ['multiply', Number.MAX_VALUE, 10, 'result_not_finite'],
  ] as const)('maps a real %s failure to %s', async (operation, a, b, code) => {
    const outcome = await calculate(operation, a, b);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe(code);
  });

  it('surfaces the supported operations from a real 404', async () => {
    // Cast: the point is to send an operation the client's type forbids but a
    // hand-written request could still produce.
    const outcome = await calculate('modulo' as 'add', 10, 3);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('unsupported_operation');
      expect(outcome.error.supportedOperations).toContain('divide');
    }
  });
});

describe('when the backend is stopped', () => {
  // The regression test for the defect this suite exists to catch. With the
  // backend down the proxy answers 502 with an empty body, so fetch resolves
  // and the response looks superficially like a reply from the API. Reporting
  // that as a malformed response tells the user the service answered strangely,
  // when it never answered at all.
  it('reports the service as unreachable, not as a malformed reply', async () => {
    await stopBackend();

    const outcome = await calculate('add', 2, 3);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('service_unavailable');
      expect(outcome.error.code).not.toBe('malformed_response');
      expect(outcome.error.message).toMatch(/backend/i);
    }
  });

  it('reports the operations lookup as unavailable too', async () => {
    await expect(fetchOperations()).resolves.toBeNull();
  });
});
