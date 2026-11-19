import { defineConfig } from '@playwright/test';

const baseURL = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    extraHTTPHeaders: { origin: baseURL },
  },
  reporter: 'list',
});
