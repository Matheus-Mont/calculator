import { defineConfig } from 'vitest/config';

/**
 * Integration tests, kept in their own config because they are slower and have
 * a prerequisite the unit tests do not: a real backend binary.
 *
 * The unit suite mocks `fetch`, which is what let a real defect through — the
 * client reported a stopped backend as a malformed reply, because no unit test
 * ever crossed a proxy. These run the actual Go server behind the actual Vite
 * proxy and call the real client, so that failure mode is covered.
 *
 * Ports are fixed rather than allocated: the client reads its base URL from the
 * environment when its module loads, so the value has to exist before the test
 * starts. They are passed to the test as environment variables so the test file
 * needs no import from this config — which keeps it type-checkable inside the
 * frontend Docker build, where this file is not present.
 */
const BACKEND_PORT = 8391;
const PROXY_PORT = 5391;

export default defineConfig({
  test: {
    globals: true,
    // No DOM needed: these exercise the API client, not React.
    environment: 'node',
    include: ['src/test/integration/**/*.test.ts'],
    env: {
      VITE_API_BASE_URL: `http://127.0.0.1:${PROXY_PORT}/api/v1`,
      INTEGRATION_BACKEND_PORT: String(BACKEND_PORT),
      INTEGRATION_PROXY_PORT: String(PROXY_PORT),
    },
    // Booting a server per file would race on the fixed ports.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
