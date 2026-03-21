import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : [['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3010',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start dev server unless PLAYWRIGHT_BASE_URL is set (pointing at a live deployment).
  // Port 3010 is used to avoid conflicts with other dev servers on 3000.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 3010',
        url: 'http://localhost:3010',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          // Intentionally omit NEXT_PUBLIC_PRIVY_APP_ID so Providers uses
          // MockAuthBridge instead of PrivyProvider. Auth state is provided
          // via window.__PRIVY_MOCK in each test (via page.addInitScript).
          NEXT_PUBLIC_PRIVY_APP_ID: '',
        },
      },
});
