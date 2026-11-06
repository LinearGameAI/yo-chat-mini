import test from 'node:test';
import assert from 'node:assert/strict';
import { throwIfAborted, timedSignal } from '../shared/abort.js';

test('cancellation check works without a native throwIfAborted method or reason', () => {
  assert.doesNotThrow(() => throwIfAborted());
  assert.doesNotThrow(() => throwIfAborted({ aborted: false } as AbortSignal));
  assert.throws(() => throwIfAborted({ aborted: true } as AbortSignal), { name: 'AbortError' });
});

test('timed request forwards parent cancellation and preserves its reason', () => {
  const parent = new AbortController();
  const request = timedSignal(parent.signal, 1000);
  const reason = new Error('navigation');
  try {
    parent.abort(reason);
    assert.equal(request.signal.aborted, true);
    assert.throws(() => throwIfAborted(request.signal), error => error === reason);
  } finally { request.dispose(); }
});

test('timeout aborts the request and cleanup cancels unused timers', async () => {
  const request = timedSignal(undefined, 5);
  try {
    await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }));
    assert.throws(() => throwIfAborted(request.signal), { name: 'TimeoutError' });
  } finally { request.dispose(); }
  const disposed = timedSignal(undefined, 5);
  disposed.dispose();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(disposed.signal.aborted, false);
});
