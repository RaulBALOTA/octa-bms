import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// HTTP-level auth suite against a real PostgreSQL (DATABASE_URL). Each file creates and
// drops its own uniquely named schema; nothing else in the database is touched.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
