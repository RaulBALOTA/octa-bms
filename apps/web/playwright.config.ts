import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:5181',
    channel: process.env.OCTA_TEST_BROWSER_CHANNEL || undefined,
    headless: true,
  },
  webServer: {
    command: process.env.OCTA_TEST_PRODUCTION === '1'
      ? 'pnpm preview --host 127.0.0.1 --port 5181'
      : 'pnpm dev --host 127.0.0.1 --port 5181',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: !process.env.CI,
  },
});
