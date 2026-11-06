import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCatalog } from '../server/content.js';
import { selectEpisode, tick } from '../server/story.js';
process.env.DATABASE_PATH = ':memory:';
process.env.DATABASE_URL = '';
const { loginSession, mapTikTokIdentity, findSession, saveSession, newSession, updateWatch, saveConversation, acquireReplyLock, releaseReplyLock, db } = await import('../server/store.js');
const { catalog } = normalizeCatalog(JSON.parse(fs.readFileSync('fixtures/spooky-doll.json', 'utf8')), 'snapshot');
after(() => db?.close());

test('the same user keeps separate playback and conversations for each drama', async () => {
  const userId = 'multi-drama-test-user';
  const first = await loginSession(catalog, userId);
  first.watch.episodes['1'].position = 23;
  first.conversations['shared-character'] = { id: 'first-drama-chat', characterId: 'shared-character', messages: [] };
  await saveSession(first);
  const otherCatalog = { ...catalog, id: 'another-drama' };
  const other = await loginSession(otherCatalog, userId);
  assert.equal(other.dramaId, otherCatalog.id);
  assert.equal(other.watch.episodes['1'].position, 0);
  assert.deepEqual(other.conversations, {});
  other.watch.episodes['1'].position = 7; await saveSession(other);
  const restored = await loginSession(catalog, userId);
  assert.equal(restored.watch.episodes['1'].position, 23);
  assert.equal(restored.conversations['shared-character'].id, 'first-drama-chat');
  assert.equal((await loginSession(otherCatalog, userId)).watch.episodes['1'].position, 7);
});
test('reverified TikTok identity rotates authentication while retaining its own story and conversation', async () => {
  const userId = await mapTikTokIdentity('test-client', 'fake-openid-for-unit-test');
  const first = await loginSession(catalog, userId); first.watch.episodes['1'].position = 17;
  first.conversations[catalog.characters[0].id] = { id: 'test-conversation', characterId: catalog.characters[0].id, messages: [] };
  await saveSession(first);
  const next = await loginSession(catalog, await mapTikTokIdentity('test-client', 'fake-openid-for-unit-test'));
  assert.notEqual(next.id, first.id); assert.notEqual(next.csrf, first.csrf); assert.equal(await findSession(first.id), undefined);
  assert.equal(next.watch.episodes['1'].position, 17); assert.equal(next.conversations[catalog.characters[0].id].id, 'test-conversation');
  const unrelated = await loginSession(catalog, await mapTikTokIdentity('another-client', 'fake-openid-for-unit-test'));
  assert.equal(unrelated.watch.episodes['1'].position, 0); assert.deepEqual(unrelated.conversations, {});
});
test('SQLite keeps watch and conversations independent and rejects stale playback writes', async () => {
  const session = await newSession(catalog, 'local');
  const stale = await findSession(session.id); assert.ok(stale);
  const character = catalog.characters[0].id;
  session.conversations[character] = { id: 'local-conversation', characterId: character, messages: [] };
  await Promise.all([updateWatch(stale, watch => { watch.episodes['1'].position = 42; }), saveConversation(session, character, true)]);
  const merged = await findSession(session.id); assert.ok(merged);
  assert.equal(merged.watch.episodes['1'].position, 42); assert.equal(merged.conversations[character].id, 'local-conversation');
  const oldTick = { playbackId: merged.watch.playbackId, nodeId: merged.watch.episodes['1'].nodeId, position: 0, playing: false };
  await updateWatch(merged, watch => selectEpisode(watch, catalog, '2'));
  await assert.rejects(updateWatch(stale, watch => tick(watch, oldTick)), /Playback changed/);
  assert.equal((await findSession(session.id))?.watch.episodeId, '2');
  const lease = await acquireReplyLock(session.id); assert.ok(lease);
  assert.equal(await acquireReplyLock(session.id), undefined);
  await releaseReplyLock(session.id, lease); assert.ok(await acquireReplyLock(session.id));
});

test('Yoroll credentials and remote conversation stay isolated per session and survive conversation writes', async () => {
  const owner = await newSession(catalog, 'local');
  const other = await newSession(catalog, 'local');
  owner.yorollAuth = { userId: 'yoroll-user-one', accessToken: 'unit-test-credential' };
  await saveSession(owner);
  const characterId = catalog.characters[0].id;
  owner.conversations[characterId] = { id: 'local-chat', characterId, messages: [],
    yoroll: { id: 'remote-chat', baseUrl: 'https://example.test/api/v1', userId: 'yoroll-user-one', historyIds: [] } };
  await saveConversation(owner, characterId);
  const restored = await findSession(owner.id);
  assert.deepEqual(restored?.yorollAuth, owner.yorollAuth);
  assert.equal(restored?.conversations[characterId].yoroll?.id, 'remote-chat');
  const unrelated = await findSession(other.id);
  assert.equal(unrelated?.yorollAuth, undefined);
  assert.deepEqual(unrelated?.conversations, {});
});
