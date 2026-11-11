import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneState } from '../shared/clone.js';

test('legacy WebViews clone JSON state without sharing nested references', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')!;
  Object.defineProperty(globalThis, 'structuredClone', { value: undefined, configurable: true });
  t.after(() => Object.defineProperty(globalThis, 'structuredClone', descriptor));
  const source = { episodes: { one: { position: 12, path: ['node-one'], watched: [[1, 3]], pendingInteraction: undefined } } };
  const cloned = cloneState(source);
  cloned.episodes.one.position = 20;
  cloned.episodes.one.path.push('node-two');
  cloned.episodes.one.watched[0][1] = 5;
  assert.equal(source.episodes.one.position, 12);
  assert.deepEqual(source.episodes.one.path, ['node-one']);
  assert.deepEqual(source.episodes.one.watched, [[1, 3]]);
});
