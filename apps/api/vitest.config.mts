import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, so Nest dependency injection works in HTTP-level tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // integration specs share one database; keep files serial
    fileParallelism: false,
  },
});
