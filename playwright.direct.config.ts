import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: 'direct.spec.ts', timeout: 30000, workers: 1,
  reporter: 'list', use: { baseURL: 'http://localhost:5187', channel: 'chrome' },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://localhost:5187', reuseExistingServer: false,
    env: { TIKTOK_CLIENT_KEY: 'local-preview-only', VITE_TIKTOK_CLIENT_KEY: 'local-preview-only' },
  },
});
