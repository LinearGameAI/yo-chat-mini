import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: 'sentry.spec.ts', timeout: 30000, workers: 1,
  reporter: 'list', use: { baseURL: 'http://localhost:5191', channel: 'chrome' },
  projects: [{ name: 'legacy-webview', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5191 --strictPort',
    url: 'http://localhost:5191', reuseExistingServer: false,
    env: { TIKTOK_CLIENT_KEY: 'local-preview-only', VITE_TIKTOK_CLIENT_KEY: 'local-preview-only',
      VITE_SENTRY_DSN: 'https://test@sentry.example.test/123', VITE_SENTRY_ENVIRONMENT: 'test', VITE_SENTRY_RELEASE: 'yo-chat-mini@test' },
  },
});
