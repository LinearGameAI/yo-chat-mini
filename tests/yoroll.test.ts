import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYorollConversation, requireYorollAuth, streamYorollReply } from '../server/yoroll.js';
import { chatProvider } from '../server/chat.js';
import type { Session } from '../shared/types.js';

const client = { baseUrl: 'https://example.test/api/v1', accessToken: 'unit-test-token', deviceId: 'session-one' };
const input = { text: 'Hello', clientRequestId: 'request-one' };
function event(name: string, data: unknown) { return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`; }
function completed(text: string) {
  return event('response.completed', { userMessage: { id: 'user-one', text: 'Hello' }, replyMessage: { id: 'reply-one', text } });
}
function sse(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    // Includes split multibyte UTF-8 and SSE frame boundaries.
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
async function snapshots() {
  const result: string[] = [];
  for await (const text of streamYorollReply(client, 'conversation/one', input, new AbortController().signal)) result.push(text);
  return result;
}

test('Yoroll is the default and requires a per-user credential rather than falling back to mock', t => {
  const previous = process.env.CHAT_PROVIDER;
  delete process.env.CHAT_PROVIDER;
  try { assert.equal(chatProvider(), 'yoroll'); }
  finally { if (previous === undefined) delete process.env.CHAT_PROVIDER; else process.env.CHAT_PROVIDER = previous; }
  assert.throws(() => requireYorollAuth({} as Session), /authentication is not ready/);
  const auth = { accessToken: 'user-token', userId: 'user-one' };
  assert.equal(requireYorollAuth({ yorollAuth: auth } as Session), auth);
});

test('creates an independent companion conversation using user Bearer auth', async t => {
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    assert.equal(String(url), 'https://example.test/api/v1/companions/character%2Fone/conversations');
    assert.deepEqual(JSON.parse(String(options.body)), { startNew: true });
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer unit-test-token');
    assert.equal(new Headers(options.headers).get('x-device-id'), 'session-one');
    assert.equal(options.redirect, 'error');
    return Response.json({ conversation: { id: 'remote-conversation' } }, { status: 201 });
  });
  assert.equal(await createYorollConversation(client, 'character/one', new AbortController().signal), 'remote-conversation');
});

test('sends the original idempotency key, renders block snapshots once, and uses final authoritative text', async t => {
  const block = (blockIndex: number, text: string, type = 'dialog') => event('block.updated', {
    messageId: 'reply-one', blockIndex, block: { type, text }, complete: false,
  });
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    assert.equal(String(url), 'https://example.test/api/v1/conversations/conversation%2Fone/responses');
    assert.deepEqual(JSON.parse(String(options.body)), { ...input, streamFormat: 'blocks' });
    return sse(block(0, '你') + block(0, '你好') + block(1, 'Options must not appear', 'options') +
      block(2, 'Welcome') + completed('你好\n\nWelcome!').trimEnd());
  });
  assert.deepEqual(await snapshots(), ['你', '你好', '你好\n\nWelcome', '你好\n\nWelcome!']);
});

test('handles text.delta and completed-only idempotent replay', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => sse(event('text.delta', { text: 'Hi' }) + completed('Hi!')));
  assert.deepEqual(await snapshots(), ['Hi', 'Hi!']);
  fetch.mock.mockImplementation(async () => sse(completed('Saved reply')));
  assert.deepEqual(await snapshots(), ['Saved reply']);
});

test('HTTP 200 failure and partial streams cannot be saved as successful replies', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => sse(event('text.delta', { text: 'partial' }) +
    event('response.failed', { error: { code: 'insufficient_credits' } })));
  await assert.rejects(snapshots(), /Not enough Yoroll credits/);
  fetch.mock.mockImplementation(async () => sse(event('text.delta', { text: 'partial' })));
  await assert.rejects(snapshots(), /interrupted/);
  fetch.mock.mockImplementation(async () => sse(event('response.completed', { replyMessage: { id: 'reply-one', text: 'Bad' } })));
  await assert.rejects(snapshots(), /invalid completed reply/);
});

test('rejects expired auth, non-SSE responses, malformed JSON, and propagates cancellation', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 401 }));
  await assert.rejects(snapshots(), /login has expired/);
  fetch.mock.mockImplementation(async () => new Response('<html>Login</html>'));
  await assert.rejects(snapshots(), /did not return a chat stream/);
  fetch.mock.mockImplementation(async () => sse('event: text.delta\ndata: broken\n\n'));
  await assert.rejects(snapshots(), /invalid chat event/);
  const controller = new AbortController();
  fetch.mock.mockImplementation(async (_url, options) => {
    assert.equal(options?.signal, controller.signal);
    controller.abort(); options!.signal!.throwIfAborted();
    return sse('');
  });
  await assert.rejects(createYorollConversation(client, 'character', controller.signal), { name: 'AbortError' });
});
