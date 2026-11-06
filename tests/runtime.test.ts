import test from 'node:test';
import assert from 'node:assert/strict';
import { playerMode } from '../src/platform/runtime.js';

test('a public client key alone must not select the TikTok player in a browser', () => {
  assert.equal(playerMode({}), 'local');
  assert.equal(playerMode({ __MINI_CLIENT_KEY__: 'real-public-key' }), 'local');
  assert.equal(playerMode({ __MINI_CLIENT_KEY__: 'real-public-key', webkit: { messageHandlers: {} } }), 'local');
});

test('a configured app with a TikTok bridge or explicit SDK dev transport uses the platform player', () => {
  const key = { __MINI_CLIENT_KEY__: 'real-public-key' };
  for (const runtime of [
    { JS2NativeBridge: { _invokeMethod() {} } }, { JS2NativeBridge: { call() {} } },
    { ToutiaoJSBridge: { invokeMethod() {} } },
    { webkit: { messageHandlers: { callMethodParams: { postMessage() {} } } } },
    { callMethodParams() {} }, { __isMinisDevMode__: true },
  ]) assert.equal(playerMode({ ...key, ...runtime }), 'tiktok');
  assert.equal(playerMode({ __MINI_CLIENT_KEY__: 'local-preview-only', __isMinisDevMode__: true }), 'local');
});
