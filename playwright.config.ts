import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testIgnore: 'direct.spec.ts', timeout: 90000, expect: { timeout: 15000 }, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure', channel: 'chrome' },
  projects: [{ name: 'iPhone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }, { name: 'Android', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'npm run dev', env: { CHAT_PROVIDER: 'mock' }, url: 'http://localhost:5173/api/health', reuseExistingServer: false, timeout: 120000 },
});
