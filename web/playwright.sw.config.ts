import { defineConfig } from '@playwright/test';

// Service worker checks against the built server (make build && ./bin/tide).
// TIDE_SW_BASE_URL points at it; the spec skips without it.
export default defineConfig({
  testDir: './e2e',
  testMatch: /service-worker\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  use: { baseURL: process.env.TIDE_SW_BASE_URL }
});
