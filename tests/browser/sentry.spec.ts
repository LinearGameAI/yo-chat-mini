import { test, expect } from '@playwright/test';

test('legacy WebView sends only JS exceptions, without logs, sessions, tracing, replay or request data', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true });
    Object.defineProperty(window, 'structuredClone', { value: undefined, configurable: true });
    for (const key of ['any', 'timeout']) Object.defineProperty(AbortSignal, key, { value: undefined, configurable: true });
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', { value: undefined, configurable: true });
  });
  await page.route('https://connect.tiktok-minis.com/drama/sdk.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.TTMinis = { init() {} };' }));
  await page.route('https://cdn.jsdelivr.net/npm/vconsole@latest/dist/vconsole.min.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.VConsole = function () {};' }));
  await page.route('https://api.lineargame.ai/api/v1/feed/games?*', route => route.fulfill({ json: { items: [], page: 1, page_size: 12, total: 0 } }));
  const payloads: string[] = [];
  await page.route('https://sentry.example.test/api/123/envelope/*', route => {
    payloads.push(route.request().postData() || '');
    return route.fulfill({ status: 200, json: {} });
  });
  await page.goto('/?private_test=should-not-send');
  await expect(page.getByRole('heading', { name: 'yoroll game' })).toBeVisible();
  await page.evaluate(() => {
    console.log('not-a-sentry-log'); console.error('not-a-sentry-console-error');
    setTimeout(() => { throw new TypeError('sentry-js-exception'); }, 0);
    void Promise.reject(new Error('sentry-unhandled-promise'));
  });
  await expect.poll(() => payloads.length).toBe(2);
  const envelopes = payloads.map(payload => payload.split('\n').filter(Boolean).map(line => JSON.parse(line)));
  for (const [, item, event] of envelopes) {
    expect(item.type).toBe('event');
    expect(event.exception.values.length).toBeGreaterThan(0);
    expect(event.environment).toBe('test');
    expect(event.release).toBe('yo-chat-mini@test');
    expect(event.request).toBeUndefined(); expect(event.user).toBeUndefined(); expect(event.breadcrumbs).toBeUndefined();
  }
  expect(payloads.join('')).not.toContain('should-not-send');
  expect(payloads.join('')).not.toContain('not-a-sentry-log');
  await page.evaluate(async () => {
    const modulePath = '/src/lib/sentry.ts'; const { errorOnlyOptions } = await import(modulePath);
    const sdkPath = '/node_modules/.vite/deps/@sentry_browser.js';
    const sdk = await import(sdkPath);
    sdk.captureMessage('not-an-exception');
    const options = errorOnlyOptions();
    if (options.beforeSendLog({} as never) !== null || options.beforeSendMetric({} as never) !== null) throw new Error('Unexpected non-error telemetry');
    await sdk.flush(2000);
  });
  expect(payloads).toHaveLength(2);
});
