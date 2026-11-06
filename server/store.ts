import './env.js';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { DRAMA_ID, type Catalog, type Conversation, type Session, type WatchState } from '../shared/types.js';
import { AppError, initialWatch } from './story.js';

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : undefined;
if (process.env.VERCEL && !sql) throw new Error('Vercel requires a persistent DATABASE_URL.');
export let db: DatabaseSync | undefined;
if (sql) {
  await sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data JSONB NOT NULL)`,
    sql`CREATE TABLE IF NOT EXISTS identities (identity TEXT PRIMARY KEY, user_id TEXT NOT NULL)`,
    sql`CREATE TABLE IF NOT EXISTS reply_locks (id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
  ]);
} else {
  const dbPath = process.env.DATABASE_PATH ?? '.data/mini.sqlite';
  if (dbPath !== ':memory:') fs.mkdirSync('.data', { recursive: true, mode: 0o700 });
  db = new DatabaseSync(dbPath);
  try { fs.chmodSync(dbPath, 0o600); } catch { /* in-memory test database */ }
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS identities (identity TEXT PRIMARY KEY, user_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reply_locks (id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);');
}
export async function saveSession(session: Session) {
  if (sql) await sql`INSERT INTO sessions(id,data) VALUES(${session.id},${JSON.stringify(session)}::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data`;
  else db!.prepare('INSERT INTO sessions(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(session.id, JSON.stringify(session));
}
export async function findSession(id?: string): Promise<Session | undefined> {
  if (!id) return;
  if (sql) return (await sql`SELECT data FROM sessions WHERE id=${id}`)[0]?.data as Session | undefined;
  const row = db!.prepare('SELECT data FROM sessions WHERE id=?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
export async function updateWatch(session: Session, change: (watch: WatchState) => void): Promise<WatchState> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = JSON.stringify(session.watch);
    change(session.watch);
    const updated = sql
      ? (await sql`UPDATE sessions SET data=jsonb_set(data,'{watch}',${JSON.stringify(session.watch)}::jsonb) WHERE id=${session.id} AND data->'watch'=${previous}::jsonb RETURNING id`).length
      : db!.prepare("UPDATE sessions SET data=json_set(data,'$.watch',json(?)) WHERE id=? AND json_extract(data,'$.watch')=json(?)").run(JSON.stringify(session.watch), session.id, previous).changes;
    if (updated) return session.watch;
    const fresh = await findSession(session.id);
    if (!fresh) throw new AppError(401, 'Reload this page before continuing.');
    session = fresh;
  }
  throw new AppError(409, 'Playback changed. Reload the player.');
}
export async function saveConversation(session: Session, characterId: string, onlyIfMissing = false): Promise<Conversation> {
  const value = JSON.stringify(session.conversations[characterId]);
  if (sql) {
    const rows = onlyIfMissing
      ? await sql`UPDATE sessions SET data=jsonb_set(data,ARRAY['conversations',${characterId}],COALESCE(data->'conversations'->${characterId},${value}::jsonb)) WHERE id=${session.id} RETURNING data->'conversations'->${characterId} AS conversation`
      : await sql`UPDATE sessions SET data=jsonb_set(data,ARRAY['conversations',${characterId}],${value}::jsonb) WHERE id=${session.id} RETURNING data->'conversations'->${characterId} AS conversation`;
    if (!rows.length) throw new AppError(401, 'Reload this page before continuing.');
    return rows[0].conversation as Conversation;
  }
  const jsonPath = `$.conversations.${JSON.stringify(characterId)}`;
  const row = db!.prepare('SELECT json_extract(data,?) AS conversation FROM sessions WHERE id=?').get(jsonPath, session.id) as { conversation: string | null } | undefined;
  if (!row) throw new AppError(401, 'Reload this page before continuing.');
  if (onlyIfMissing && row.conversation) return JSON.parse(row.conversation);
  db!.prepare('UPDATE sessions SET data=json_set(data,?,json(?)) WHERE id=?').run(jsonPath, value, session.id);
  return session.conversations[characterId];
}
export async function newSession(catalog: Catalog, identity: Session['identity'], userId: string = randomUUID()): Promise<Session> {
  const session: Session = { id: randomUUID(), csrf: randomUUID(), identity, userId, dramaId: catalog.id, watch: initialWatch(catalog), conversations: {} };
  await saveSession(session); return session;
}
export async function mapTikTokIdentity(clientKey: string, openId: string) {
  const identity = `${clientKey}:${openId}`;
  if (sql) return (await sql`INSERT INTO identities(identity,user_id) VALUES(${identity},${randomUUID()}) ON CONFLICT(identity) DO UPDATE SET identity=excluded.identity RETURNING user_id`)[0].user_id as string;
  const existing = db!.prepare('SELECT user_id FROM identities WHERE identity=?').get(identity) as { user_id: string } | undefined;
  if (existing) return existing.user_id;
  const userId = randomUUID(); db!.prepare('INSERT INTO identities VALUES(?,?)').run(identity, userId); return userId;
}
export async function loginSession(catalog: Catalog, userId: string): Promise<Session> {
  const row = sql
    ? (await sql`SELECT id,data::text FROM sessions WHERE data->>'identity'='tiktok' AND data->>'userId'=${userId} AND COALESCE(data->>'dramaId',${DRAMA_ID})=${catalog.id} LIMIT 1`)[0] as { id: string; data: string } | undefined
    : db!.prepare("SELECT id,data FROM sessions WHERE json_extract(data,'$.identity')='tiktok' AND json_extract(data,'$.userId')=? AND COALESCE(json_extract(data,'$.dramaId'),?)=? LIMIT 1").get(userId, DRAMA_ID, catalog.id) as { id: string; data: string } | undefined;
  if (!row) return newSession(catalog, 'tiktok', userId);
  const s: Session = JSON.parse(row.data);
  // Rotate both session ID and CSRF token on every freshly verified login.
  s.id = randomUUID(); s.csrf = randomUUID(); delete s.watch.lastTick; s.watch.playbackId = randomUUID();
  if (sql) await sql.transaction([
    sql`DELETE FROM sessions WHERE id=${row.id}`,
    sql`INSERT INTO sessions(id,data) VALUES(${s.id},${JSON.stringify(s)}::jsonb)`,
  ]);
  else { db!.prepare('DELETE FROM sessions WHERE id=?').run(row.id); await saveSession(s); }
  return s;
}
// A database lease also prevents duplicate streams across different Vercel instances.
export async function acquireReplyLock(id: string): Promise<string | undefined> {
  const token = randomUUID(); const now = Date.now(); const expiresAt = now + 300000;
  const rows = sql
    ? await sql`INSERT INTO reply_locks VALUES(${id},${token},${expiresAt}) ON CONFLICT(id) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at WHERE reply_locks.expires_at < ${now} RETURNING token`
    : db!.prepare('INSERT INTO reply_locks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at WHERE reply_locks.expires_at < ? RETURNING token').all(id, token, expiresAt, now);
  return rows.length ? token : undefined;
}
export async function releaseReplyLock(id: string, token: string) {
  if (sql) await sql`DELETE FROM reply_locks WHERE id=${id} AND token=${token}`;
  else db!.prepare('DELETE FROM reply_locks WHERE id=? AND token=?').run(id, token);
}
