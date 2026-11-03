import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Catalog, Session } from '../shared/types.js';
import { initialWatch } from './story.js';

fs.mkdirSync('.data', { recursive: true, mode: 0o700 });
const dbPath = process.env.DATABASE_PATH ?? '.data/mini.sqlite';
export const db = new DatabaseSync(dbPath);
try { fs.chmodSync(dbPath, 0o600); } catch { /* in-memory test database */ }
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS identities (identity TEXT PRIMARY KEY, user_id TEXT NOT NULL);');
export function saveSession(session: Session) {
  db.prepare('INSERT INTO sessions(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(session.id, JSON.stringify(session));
}
export function findSession(id?: string): Session | undefined {
  if (!id) return;
  const row = db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
export function newSession(catalog: Catalog, identity: Session['identity'], userId: string = randomUUID()): Session {
  const session: Session = { id: randomUUID(), csrf: randomUUID(), identity, userId, watch: initialWatch(catalog), conversations: {} };
  saveSession(session); return session;
}
export function mapTikTokIdentity(clientKey: string, openId: string) {
  const identity = `${clientKey}:${openId}`;
  const existing = db.prepare('SELECT user_id FROM identities WHERE identity=?').get(identity) as { user_id: string } | undefined;
  if (existing) return existing.user_id;
  const userId = randomUUID(); db.prepare('INSERT INTO identities VALUES(?,?)').run(identity, userId); return userId;
}
export function loginSession(catalog: Catalog, userId: string): Session {
  const row = db.prepare("SELECT id,data FROM sessions WHERE json_extract(data,'$.identity')='tiktok' AND json_extract(data,'$.userId')=? LIMIT 1").get(userId) as { id: string; data: string } | undefined;
  if (!row) return newSession(catalog, 'tiktok', userId);
  const s: Session = JSON.parse(row.data);
  // Rotate both session ID and CSRF token on every freshly verified login.
  db.prepare('DELETE FROM sessions WHERE id=?').run(row.id);
  s.id = randomUUID(); s.csrf = randomUUID(); delete s.watch.lastTick; s.watch.playbackId = randomUUID();
  saveSession(s); return s;
}
