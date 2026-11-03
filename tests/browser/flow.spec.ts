import { expect, test } from '@playwright/test';

test('real story playback → context-limited mock chat → resume, history and chapter restoration', async ({ page }, info) => {
  const browserErrors: string[] = []; page.on('pageerror', e => browserErrors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Spooky Doll’s Revenge', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Daniel Renault/ })).toBeVisible();
  await page.screenshot({ path: `verification/${info.project.name}-home.png`, fullPage: true, scale: 'css' });
  await page.getByRole('button', { name: 'Start Watching', exact: true }).click();
  await expect(page.locator('.band-right')).toContainText('Stage 1');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(9);
  await page.getByRole('button', { name: 'Pause video', exact: true }).click({ force: true });
  const pausedAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.screenshot({ path: `verification/${info.project.name}-player.png`, scale: 'css' });
  await page.getByRole('button', { name: /Chat with Daniel Renault/ }).click();
  await expect(page.getByText('Mock replies · Local conversation preview', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Daniel' }).fill('What just happened?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.message.assistant')).toContainText('last words you heard');
  await expect(page.getByRole('textbox', { name: 'Message Daniel' })).toBeEnabled();
  await page.screenshot({ path: `verification/${info.project.name}-chat.png`, scale: 'css' });
  await page.reload();
  await expect(page.locator('.message.assistant')).toContainText('last words you heard');
  await page.getByRole('button', { name: 'Return to drama', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(pausedAt - 1);
  // The browser's back/forward gestures must retain the same position too.
  await page.goBack();
  await page.goForward();
  await expect(page.locator('.player-top')).toContainText('EP01');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(pausedAt - 1);
  await page.getByRole('button', { name: 'Next episode', exact: true }).click();
  await expect(page.locator('.player-top')).toContainText('EP02');
  await page.getByRole('button', { name: 'Previous episode', exact: true }).click();
  await expect(page.locator('.player-top')).toContainText('EP01');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(pausedAt - 1);
  await page.getByRole('button', { name: 'Open episodes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Episodes' })).toBeVisible();
  await expect(page.locator('.episode-grid button')).toHaveCount(10);
  await page.screenshot({ path: `verification/${info.project.name}-episodes.png`, scale: 'css' });
  await page.getByRole('button', { name: 'Close episodes', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
});

test('saved position survives leaving before the media metadata loads', async ({ page }) => {
  await page.goto('/#watch');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 12; });
  await page.getByRole('button', { name: 'Back to drama', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue Watching', exact: true })).toBeVisible();

  // Hold the media network request while the page itself and API remain available.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\.mp4(?:\?|$)/, async route => { await held; await route.abort().catch(() => {}); });
  try {
    await page.getByRole('button', { name: 'Continue Watching', exact: true }).click();
    await expect(video).toHaveJSProperty('readyState', 0);
    await page.getByRole('button', { name: /Chat with Daniel Renault/ }).click();
    await expect(page.getByRole('textbox', { name: 'Message Daniel' })).toBeEnabled();
    const bootstrap = await (await page.request.get('/api/bootstrap')).json();
    expect(bootstrap.watch.episodes[bootstrap.watch.episodeId].position).toBeCloseTo(12, 0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await page.getByRole('button', { name: 'Return to drama', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(11.5);
});

test('published branch selection survives chat and page refresh', async ({ page }) => {
  await page.goto('/#watch');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(1);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = v.duration - .3; });
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Story choices' })).toBeVisible();
  await page.getByRole('button', { name: /Chat with Daniel Renault/ }).click();
  await page.getByRole('button', { name: 'Return to drama', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Story choices' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Story choices' })).toBeVisible();
  await page.getByRole('button', { name: '“Why should I?”', exact: true }).click();
  await expect.poll(() => video.getAttribute('src')).toContain('B01');
  await page.getByRole('button', { name: /Chat with Daniel Renault/ }).click();
  await expect(page.getByRole('textbox', { name: 'Message Daniel' })).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Return to drama', exact: true }).click();
  await expect.poll(() => video.getAttribute('src')).toContain('B01');
});

test('external entry params resolve the real episode and character; other dramas rejected', async ({ page }) => {
  await page.goto('/?drama_id=900a3d4e-6589-4c66-8287-d9bd06937c11&episode_id=dc4e4e08-73aa-4d87-be96-829044919edf&character_id=yt_daniel_renault_married_doll');
  await expect(page.locator('.chat-context')).toContainText('EP02');
  await page.getByRole('button', { name: 'Return to drama', exact: true }).click();
  await expect(page.locator('.player-top')).toContainText('EP02');
  await page.goto('/?drama_id=wrong');
  await expect(page.getByRole('alert')).toContainText('only contains');
});

test('browser back to the entry preserves playback and QTE returns a real branch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Watching', exact: true }).click();
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(3);
  await page.goBack();
  await page.getByRole('button', { name: 'Continue Watching', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(2.7);
  await page.getByRole('button', { name: 'Next episode', exact: true }).click();
  await expect(page.locator('.player-top')).toContainText('EP02');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(1);
  const previous = await video.getAttribute('src');
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = v.duration - .3; });
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tap now', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tap now', exact: true }).click();
  await expect.poll(() => video.getAttribute('src')).not.toBe(previous);
  await expect(page.locator('.player-top')).toContainText('EP02');
});
