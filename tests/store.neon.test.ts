import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import { normalizeCatalog } from '../server/content.js';
import { selectEpisode, tick } from '../server/story.js';

test('Neon persists sessions across processes and coordinates stream leases', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { newSession, saveSession, findSession, mapTikTokIdentity, loginSession, acquireReplyLock, releaseReplyLock, updateWatch, saveConversation } = await import('../server/store.js');
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const { catalog } = normalizeCatalog(JSON.parse(fs.readFileSync('fixtures/spooky-doll.json', 'utf8')), 'snapshot');
  const identity = `integration-${randomUUID()}`;
  const sessionIds: string[] = [];
  const lockId = `integration-${randomUUID()}`;
  try {
    const session = await newSession(catalog, 'local'); sessionIds.push(session.id);
    session.watch.episodes['1'].position = 17; await saveSession(session);
    const persisted = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `const { findSession } = await import('./server/store.ts'); console.log(JSON.stringify((await findSession(${JSON.stringify(session.id)}))?.watch.episodes['1'].position));`], { encoding: 'utf8' });
    assert.equal(JSON.parse(persisted), 17);
    const stale = await findSession(session.id); assert.ok(stale);
    const character = catalog.characters[0].id;
    session.conversations[character] = { id: randomUUID(), characterId: character, messages: [] };
    await Promise.all([updateWatch(stale, watch => { watch.episodes['1'].position = 42; }), saveConversation(session, character, true)]);
    const merged = await findSession(session.id); assert.ok(merged);
    assert.equal(merged.watch.episodes['1'].position, 42); assert.equal(merged.conversations[character].id, session.conversations[character].id);
    const oldTick = { playbackId: merged.watch.playbackId, nodeId: merged.watch.episodes['1'].nodeId, position: 0, playing: false };
    await updateWatch(merged, watch => selectEpisode(watch, catalog, '2'));
    await assert.rejects(updateWatch(stale, watch => tick(watch, oldTick)), /Playback changed/);
    assert.equal((await findSession(session.id))?.watch.episodeId, '2');
    const userId = await mapTikTokIdentity(identity, 'integration-identity');
    assert.equal(await mapTikTokIdentity(identity, 'integration-identity'), userId);
    const first = await loginSession(catalog, userId); sessionIds.push(first.id);
    first.watch.episodes['1'].position = 23; await saveSession(first);
    const rotated = await loginSession(catalog, userId); sessionIds.push(rotated.id);
    assert.notEqual(rotated.id, first.id); assert.equal(await findSession(first.id), undefined);
    assert.equal(rotated.watch.episodes['1'].position, 23);
    const lease = await acquireReplyLock(lockId); assert.ok(lease);
    const competing = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `const { acquireReplyLock } = await import('./server/store.ts'); console.log(JSON.stringify(await acquireReplyLock(${JSON.stringify(lockId)}) ?? null));`], { encoding: 'utf8' });
    assert.equal(JSON.parse(competing), null);
    await releaseReplyLock(lockId, 'unrelated-owner'); assert.equal(await acquireReplyLock(lockId), undefined);
    await releaseReplyLock(lockId, lease); assert.ok(await acquireReplyLock(lockId));
  } finally {
    await sql`DELETE FROM reply_locks WHERE id=${lockId}`;
    await sql`DELETE FROM sessions WHERE id=ANY(${sessionIds}::text[])`;
    await sql`DELETE FROM identities WHERE identity=${`${identity}:integration-identity`}`;
  }
});
