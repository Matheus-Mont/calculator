import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy the API in development so the browser sees a single origin and
    // CORS never comes into play locally. In production the same path is
    // served by nginx, which proxies to the backend container.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Integration tests live in their own config: they boot a real Go binary,
    // which this suite (and the frontend Docker build) has no toolchain for.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/test/integration/**'],
    css: false,
    coverage: {
      provider: 'v8',
      // cobertura is what GitLab parses for the coverage visualisation.
      reporter: ['text', 'html', 'lcov', 'cobertura'],
      include: ['src/**/*.{ts,tsx}'],
      // Entry point and type-only modules carry no logic worth covering.
      exclude: ['src/main.tsx', 'src/test/**', 'src/**/*.test.{ts,tsx}', 'src/types.ts'],
    },
  },
});
