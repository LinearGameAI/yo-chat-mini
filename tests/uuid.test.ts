import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from '../shared/uuid.js';

test('uses the native UUID generator when available', () => {
  assert.match(randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('older WebViews produce UUID v4 from secure random bytes without randomUUID', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues(bytes: Uint8Array) { bytes.forEach((_, index) => { bytes[index] = index; }); return bytes; },
  } });
  assert.equal(randomUUID(), '00010203-0405-4607-8809-0a0b0c0d0e0f');
});
