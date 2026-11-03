import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCatalog } from '../server/content.js';
process.env.DATABASE_PATH = ':memory:';
const { loginSession, mapTikTokIdentity, findSession, saveSession, db } = await import('../server/store.js');
const { catalog } = normalizeCatalog(JSON.parse(fs.readFileSync('fixtures/spooky-doll.json', 'utf8')), 'snapshot');
test('reverified TikTok identity rotates authentication while retaining its own story and conversation', () => {
  const userId = mapTikTokIdentity('test-client', 'fake-openid-for-unit-test');
  const first = loginSession(catalog, userId); first.watch.episodes['1'].position = 17;
  first.conversations[catalog.characters[0].id] = { id: 'test-conversation', characterId: catalog.characters[0].id, messages: [] };
  saveSession(first);
  const next = loginSession(catalog, mapTikTokIdentity('test-client', 'fake-openid-for-unit-test'));
  assert.notEqual(next.id, first.id); assert.notEqual(next.csrf, first.csrf); assert.equal(findSession(first.id), undefined);
  assert.equal(next.watch.episodes['1'].position, 17); assert.equal(next.conversations[catalog.characters[0].id].id, 'test-conversation');
  const unrelated = loginSession(catalog, mapTikTokIdentity('another-client', 'fake-openid-for-unit-test'));
  assert.equal(unrelated.watch.episodes['1'].position, 0); assert.deepEqual(unrelated.conversations, {});
  db.close();
});
