import { expect, test } from '@playwright/test';

test('homepage loads only the list and preserves cards when retrying pagination', async ({ page }) => {
  let attempts = 0;
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname); });
  await page.route('**/api/dramas?*', async route => {
    const secondPage = new URL(route.request().url()).searchParams.get('page') === '2';
    if (secondPage && ++attempts === 1) {
      await route.fulfill({ status: 503, json: { error: '短剧列表加载失败，请稍后重试。' } }); return;
    }
    await route.fulfill({ json: {
      items: [{ game_id: secondPage ? 'two' : 'one', title: secondPage ? '命运时刻' : '与最后的龙结契',
        game_engine: 'drama', cover_image: '', display_count: 7200, tags: '奇幻,爱情', has_paid_content: true }],
      page: secondPage ? 2 : 1, page_size: 12, total: 2,
    } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'yoroll game' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('7.2K次播放 · 奇幻 · 爱情')).toBeVisible();
  await page.getByRole('button', { name: '加载更多' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('已加载全部短剧')).toBeVisible();
  expect(requests.every(path => path === '/api/dramas')).toBe(true);
});

test('homepage renders a real empty feed', async ({ page }) => {
  await page.route('**/api/dramas?*', route => route.fulfill({ json: { items: [], page: 1, page_size: 12, total: 0 } }));
  await page.goto('/');
  await expect(page.getByText('暂无互动短剧')).toBeVisible();
  await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0);
});

test('a homepage story opens the real player, existing detail and linked character chat', async ({ page }) => {
  const id = '900a3d4e-6589-4c66-8287-d9bd06937c11';
  await page.route('**/api/dramas?*', route => route.fulfill({ json: {
    items: [{ game_id: id, title: 'The Spooky Doll’s Revenge', cover_image: '', game_engine: 'drama', display_count: 1, tags: '' }],
    page: 1, page_size: 12, total: 1,
  } }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('link', { name: '观看The Spooky Doll’s Revenge' }).click();
  await expect(page.locator('.player-top')).toContainText('第1集');
  await expect(page.locator('.player-title')).toHaveText('The Spooky Doll’s Revenge');
  await expect(page.locator('.captions-toggle')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Subtitles|倍速|点赞|收藏|转发|全屏|Hide player controls|Show player controls/ })).toHaveCount(0);
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 8; });
  await page.getByRole('button', { name: '和角色聊聊', exact: true }).click();
  await expect(page.locator('.detail-page')).toBeVisible();
  await page.getByRole('button', { name: '返回视频' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(7.5);
  await page.getByRole('button', { name: '和角色聊聊', exact: true }).click();
  await page.getByRole('button', { name: /Chat with Daniel Renault/ }).click();
  await expect(page.getByRole('textbox', { name: 'Message Daniel' })).toBeEnabled();
  await page.getByRole('button', { name: 'Return to drama', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(7.5);
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'yoroll game', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a different story opens its own video and handles missing linked characters', async ({ page }) => {
  const id = 'af879808-ca41-4196-8955-61774be098b4';
  await page.goto(`/?drama_id=${id}#watch`);
  await expect(page.locator('.player-title')).toHaveText('Watch Found homeless');
  await expect(page.getByRole('button', { name: '和角色聊聊', exact: true })).toHaveCount(0);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Next episode', exact: true }).click();
  await expect(page.locator('.player-top')).toContainText('第2集');
  await page.reload();
  await expect(page.locator('.player-title')).toHaveText('Watch Found homeless');
  await expect(page.locator('.player-top')).toContainText('第2集');
});
