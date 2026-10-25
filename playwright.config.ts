import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui', fullyParallel: true, forbidOnly: Boolean(process.env.CI),
  retries: 0, ...(process.env.CI ? { workers: 2 } : {}),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: {
    ...devices['Desktop Chrome'],
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  } }],
  webServer: [
    { command: 'node --import tsx scripts/start-e2e.ts', url: 'http://127.0.0.1:3000/health/ready', reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
  ],
});
