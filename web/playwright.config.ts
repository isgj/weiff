import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'line',
  // The embedded app persists its selected repository in one shared test config.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:17000',
    launchOptions: process.env['CI'] ? {} : { executablePath: '/usr/bin/google-chrome' },
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command:
      'npm run build && ./dist/weiff -addr 127.0.0.1:17000 -config-dir /tmp/weiff-playwright',
    cwd: '..',
    url: 'http://127.0.0.1:17000/api/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
