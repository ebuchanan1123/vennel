import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    extraHTTPHeaders: { origin: 'http://localhost:3000' },
  },
  reporter: 'list',
});
