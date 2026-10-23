import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, so Nest dependency injection works in HTTP-level tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    // PostgreSQL-backed suites run via `pnpm test:auth` (vitest.integration.mts)
    exclude: ['test/**', 'node_modules/**', 'dist/**'],
    // integration specs share one database; keep files serial
    fileParallelism: false,
  },
});
