import { test, expect, type Page } from '@playwright/test';

const main = 'https://api.lineargame.ai/api/v1';
const chat = 'https://chat-api.lineargame.ai/api/v1';
const cdn = 'https://drneqli4lopih.cloudfront.net/direct-test';
const dramaId = 'direct-drama';
const characterId = 'direct-character';
// Exercise every direct-client flow against the older WebView API surface.
test.beforeEach(async ({ page }) => {
  // The debugger launcher overlaps the mobile send button; transport tests do not exercise it.
  await page.route('https://cdn.jsdelivr.net/npm/vconsole@latest/dist/vconsole.min.js', route => route.fulfill({
    contentType: 'application/javascript', body: 'window.VConsole = function () {};',
  }));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'structuredClone', { value: undefined, configurable: true });
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true });
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', { value: undefined, configurable: true });
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  });
});
function frame(event: string, data: unknown) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
async function story(page: Page) {
  const unexpected: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === 'http://localhost:5187' && url.pathname.startsWith('/api/')) unexpected.push(url.href);
  });
  await page.route(`${main}/feed/games/${dramaId}`, route => route.fulfill({ json: { game: {
    game_id: dramaId, game_engine: 'drama', game_json_url: `${cdn}/game.json`, title: 'Direct story', cover_image: `${cdn}/cover.jpg`,
    characters: [{ yochat_id: characterId, name: 'Daniel', image_url: `${cdn}/cover.jpg` }],
  } } }));
  await page.route(`${cdn}/game.json`, route => route.fulfill({ json: { chapters: [{ id: '1', title: 'Chapter 1', dataPath: 'chapter.json' }] } }));
  await page.route(`${cdn}/chapter.json`, route => route.fulfill({ json: {
    externalId: 'episode-one', meta: { startNodeId: 'node-one' }, nodes: [{ id: 'node-one', video: 'one.mp4' }],
  } }));
  await page.route(`${cdn}/cover.jpg`, route => route.fulfill({ status: 204 }));
  return unexpected;
}
async function auth(page: Page, user = 'user-one') {
  await page.route(`${main}/users/login`, route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'test@example.com', password: 'test-password' });
    return route.fulfill({ json: { token: 'test-user-token' } });
  });
  await page.route(`${main}/users/me`, route => {
    expect(route.request().headers().authorization).toBe('Bearer test-user-token');
    return route.fulfill({ json: { id: user } });
  });
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('homepage renders in WebViews without crypto.randomUUID', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${main}/feed/games?*`, route => route.fulfill({ json: { items: [], page: 1, page_size: 12, total: 0 } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'yoroll game' })).toBeVisible({ timeout: 3000 });
  expect(errors).toEqual([]);
});

test('homepage calls the production feed directly and preserves pagination on retry', async ({ page }) => {
  let secondAttempts = 0;
  const requested: string[] = [];
  await page.route(`${main}/feed/games?*`, route => {
    const url = new URL(route.request().url()); requested.push(url.href);
    expect(url.searchParams.get('game_engine')).toBe('drama');
    expect(url.searchParams.get('page_size')).toBe('12');
    const second = url.searchParams.get('page') === '2';
    if (second && ++secondAttempts === 1) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    return route.fulfill({ json: { items: [{ game_id: second ? 'two' : 'one', title: second ? 'Two' : 'One', game_engine: 'drama', tags: '', display_count: 1 }], page: second ? 2 : 1, page_size: 12, total: 2 } });
  });
  const unexpected = await story(page);
  await page.goto('/'); await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: '加载更多' }).click();
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: '重试' }).click(); await expect(page.getByRole('listitem')).toHaveCount(2);
  expect(requested).toHaveLength(3); expect(unexpected).toEqual([]);
});

test('static client logs in, creates a direct conversation, streams authoritative text and restores history', async ({ page }) => {
  const unexpected = await story(page);
  let completed = false; let creates = 0;
  await page.route(`${chat}/companions/${characterId}/conversations`, route => {
    creates++; expect(route.request().headers().authorization).toBe('Bearer test-user-token');
    expect(route.request().postDataJSON()).toEqual({ startNew: true });
    return route.fulfill({ json: { conversation: { id: 'conversation-one' } } });
  });
  await page.route(`${chat}/conversations/conversation-one/messages?*`, route => route.fulfill({ json: {
    messages: completed ? [{ id: 'u1', role: 'user', text: 'Hello' }, { id: 'a1', role: 'assistant', text: 'Final reply' }] : [],
  } }));
  await page.route(`${chat}/conversations/conversation-one/responses`, route => {
    expect(route.request().postDataJSON()).toMatchObject({ text: 'Hello', streamFormat: 'blocks' });
    expect(route.request().postDataJSON().clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(route.request().headers().authorization).toBe('Bearer test-user-token'); completed = true;
    return route.fulfill({ contentType: 'text/event-stream', body:
      frame('block.updated', { messageId: 'a1', blockIndex: 0, block: { type: 'dialog', text: 'Partial' }, complete: false }) +
      frame('response.completed', { userMessage: { id: 'u1', text: 'Hello' }, replyMessage: { id: 'a1', text: 'Final reply' } }),
    });
  });
  await page.goto(`/?drama_id=${dramaId}#chat`);
  await expect(page.getByRole('heading', { name: 'Sign in to Yoroll' })).toBeVisible();
  await auth(page);
  await page.getByRole('textbox', { name: 'Message Daniel' }).fill('Hello');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.message.assistant')).toHaveText('Final reply');
  await page.reload(); await expect(page.locator('.message.assistant')).toHaveText('Final reply');
  expect(creates).toBe(1); expect(unexpected).toEqual([]);
});

test('expired Yoroll token returns to login without proxy fallback', async ({ page }) => {
  const unexpected = await story(page);
  await page.route(`${chat}/companions/${characterId}/conversations`, route => route.fulfill({ status: 401, json: { error: { code: 'auth_login_required' } } }));
  await page.goto(`/?drama_id=${dramaId}#chat`); await auth(page);
  await expect(page.getByRole('heading', { name: 'Sign in to Yoroll' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Daniel' })).toBeDisabled();
  expect(unexpected).toEqual([]);
});

test('static story progress survives reload without an adapter or database', async ({ page }) => {
  const unexpected = await story(page);
  await page.goto(`/?drama_id=${dramaId}#chat`);
  await expect(page.getByRole('heading', { name: 'Sign in to Yoroll' })).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = '/src/lib/api.ts';
    const { api } = await import(modulePath);
    const state = await api('/bootstrap');
    await api('/watch/tick', { playbackId: state.watch.playbackId, nodeId: 'node-one', position: 12, playing: false });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to Yoroll' })).toBeVisible();
  const position = await page.evaluate(async () => {
    const modulePath = '/src/lib/api.ts';
    const { api } = await import(modulePath);
    const state = await api('/bootstrap');
    return state.watch.episodes[state.watch.episodeId].position;
  });
  expect(position).toBe(12); expect(unexpected).toEqual([]);
});

test('ordinary web playback uses video even with a real client key and loaded Minis SDK', async ({ page }) => {
  await story(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, '__MINI_CLIENT_KEY__', { get: () => 'real-public-key', set: () => {}, configurable: true });
  });
  await page.route('https://connect.tiktok-minis.com/drama/sdk.js', route => route.fulfill({ contentType: 'application/javascript',
    body: 'window.TTMinis = { init() {}, getPlayer() { throw new Error("Native player called in a browser"); } };' }));
  await page.route(`${cdn}/one.mp4`, route => route.fulfill({ status: 204 }));
  await page.goto(`/?drama_id=${dramaId}#watch`);
  await expect(page.locator('video')).toHaveAttribute('src', `${cdn}/one.mp4`);
  await expect(page.locator('.player-page')).not.toContainText('VITE_TIKTOK_MEDIA_MAP_URL');
});

test('failed partial stream can retry the same idempotency key', async ({ page }) => {
  await story(page);
  await page.route(`${chat}/companions/${characterId}/conversations`, route => route.fulfill({ json: { conversation: { id: 'conversation-two' } } }));
  let done = false;
  await page.route(`${chat}/conversations/conversation-two/messages?*`, route => route.fulfill({ json: { messages: done ? [{ id: 'a2', text: 'Recovered', role: 'assistant' }] : [] } }));
  const ids: string[] = [];
  await page.route(`${chat}/conversations/conversation-two/responses`, route => {
    ids.push(route.request().postDataJSON().clientRequestId);
    if (ids.length === 1) return route.fulfill({ contentType: 'text/event-stream', body: frame('text.delta', { text: 'partial' }) + frame('response.failed', { code: 'insufficient_credits' }) });
    done = true;
    return route.fulfill({ contentType: 'text/event-stream', body: frame('response.completed', { userMessage: { id: 'u2', text: 'Hello' }, replyMessage: { id: 'a2', text: 'Recovered' } }) });
  });
  await page.goto(`/?drama_id=${dramaId}#chat`); await auth(page);
  await page.getByRole('textbox', { name: 'Message Daniel' }).fill('Hello');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('credits');
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.message.assistant')).toHaveText('Recovered');
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
});
