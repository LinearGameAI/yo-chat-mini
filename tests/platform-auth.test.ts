import test from 'node:test';
import assert from 'node:assert/strict';
import { loginTikTokPlatform, platformTokens, platformRequest, refreshPlatform, PlatformAuthError } from '../shared/platform-auth.js';

const base = 'https://auth.example.test/api/v1';
test('TikTok code is exchanged only with unified auth, then identity is verified with the platform token', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    calls.push(String(url));
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    if (calls.length === 1) {
      assert.deepEqual(JSON.parse(String(options.body)), { code: 'one-time-code' });
      assert.equal(new Headers(options.headers).get('authorization'), null);
      return Response.json({ token: 'platform-access', refresh_token: 'platform-refresh', expires_at: '2026-12-01T00:00:00Z' });
    }
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer platform-access');
    return Response.json({ id: 'platform-user' });
  });
  const result = await loginTikTokPlatform(base, 'one-time-code', {});
  assert.deepEqual(calls, [base + '/users/oauth/tiktok/login', base + '/users/me']);
  assert.equal(result.userId, 'platform-user'); assert.equal(result.refreshToken, 'platform-refresh');
});

test('invalid provider code or platform response cannot establish a session', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error_code: 'auth_oauth_failed', error_message: 'Code expired' }, { status: 401 }); });
  await assert.rejects(loginTikTokPlatform(base, 'code', {}), error => error instanceof PlatformAuthError && error.status === 401);
  assert.equal(calls, 1);
  assert.throws(() => platformTokens({ access_token: 'upstream-tiktok-token' }), /platform did not return/);
  await assert.rejects(loginTikTokPlatform(base, '', {}), /valid login code/);
  assert.equal(calls, 1);
});

test('refresh uses the unified refresh protocol and accepts the rotated token pair', async t => {
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    assert.equal(String(url), base + '/users/token/refresh');
    assert.deepEqual(JSON.parse(String(options.body)), { refresh_token: 'previous-refresh' });
    return Response.json({ token: 'new-access', refresh_token: 'new-refresh' });
  });
  assert.equal((await refreshPlatform(base, 'previous-refresh', {})).refreshToken, 'new-refresh');
});

test('logout handles an empty 204 response and auth requests reject insecure origins', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 204 }); });
  assert.equal(await platformRequest(base, 'users/logout', { method: 'POST' }), undefined);
  await assert.rejects(platformRequest('http://public.example/api/v1', 'users/logout', {}), /HTTPS/);
  assert.equal(calls, 1);
});

test('an aborted SDK login cannot submit its code or persist identity', async t => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}); });
  await assert.rejects(loginTikTokPlatform(base, 'unused-code', {}, controller.signal));
  assert.equal(calls, 0);
});
