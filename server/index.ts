import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { loadContent } from './content.js';
import { AppError, advance, finishNode, selectEpisode, storyContext, tick, visibleMessages } from './story.js';
import { findSession, loginSession, mapTikTokIdentity, newSession, saveSession } from './store.js';
import { chatProvider, reply } from './chat.js';
import type { Session, Message, Conversation } from '../shared/types.js';

try { process.loadEnvFile('.env.local'); } catch { /* optional */ }
const mode = process.env.APP_MODE === 'tiktok' ? 'tiktok' : 'local';
const provider = chatProvider();
const { catalog, cues } = await loadContent();
const app = express();
app.disable('x-powered-by'); app.use(express.json({ limit: '20kb' }));
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(v => v.trim()).filter(Boolean));
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) { res.status(403).json({ error: 'This application origin is not allowed.' }); return; }
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.vary('Origin'); }
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token'); res.sendStatus(204); return; }
  next();
});
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const cookieName = 'yoroll_mini_session';
function cookieId(req: Request) { return req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1); }
function setCookie(res: Response, id: string) {
  const crossSite = mode === 'tiktok' && process.env.COOKIE_CROSS_SITE === 'true';
  res.cookie(cookieName, id, { httpOnly: true, sameSite: crossSite ? 'none' : 'lax', secure: crossSite || (mode === 'tiktok' && process.env.NODE_ENV === 'production'), maxAge: 30 * 86400000, path: '/' });
}
function sessionFor(req: Request, res: Response): Session {
  let s = findSession(cookieId(req));
  if (s && s.identity !== mode) s = undefined;
  if (!s && mode === 'local') { s = newSession(catalog, 'local'); setCookie(res, s.id); }
  if (!s) throw new AppError(401, 'TikTok login is required.');
  return s;
}
function mutationSession(req: Request, res: Response) {
  const s = sessionFor(req, res);
  if (req.headers['x-csrf-token'] !== s.csrf) throw new AppError(403, 'Reload this page before continuing.');
  return s;
}
app.get('/api/health', (_req, res) => res.json({ ok: true, mode, contentSource: catalog.source, chatProvider: provider }));
app.get('/api/bootstrap', (req, res) => {
  let s: Session | undefined;
  try { s = sessionFor(req, res); } catch { /* TikTok login pending */ }
  res.json({ catalog, mode, chatProvider: provider, authenticated: !!s, csrf: s?.csrf, watch: s?.watch });
});
app.post('/api/auth/tiktok', async (req, res) => {
  if (mode !== 'tiktok') throw new AppError(400, 'TikTok login is disabled in local mode.');
  const { code } = z.object({ code: z.string().min(1).max(2048) }).strict().parse(req.body);
  const clientKey = process.env.TIKTOK_CLIENT_KEY; const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !secret) throw new AppError(503, 'Server TikTok credentials are not configured.');
  const result = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: clientKey, client_secret: secret, code, grant_type: 'authorization_code' }) });
  const data = await result.json();
  if (!result.ok || typeof data.open_id !== 'string' || !data.access_token) throw new AppError(401, 'TikTok could not verify this login.');
  // Never return or log upstream tokens. Identity mapping stays in this independent adapter.
  const s = loginSession(catalog, mapTikTokIdentity(clientKey, data.open_id));
  setCookie(res, s.id); res.json({ ok: true });
});
app.post('/api/watch/select', (req, res) => {
  const body = z.object({ episodeId: z.string().max(100), restart: z.boolean().optional() }).strict().parse(req.body);
  const s = mutationSession(req, res); selectEpisode(s.watch, catalog, body.episodeId, body.restart); saveSession(s); res.json(s.watch);
});
app.post('/api/watch/tick', (req, res) => {
  const body = z.object({ playbackId: z.string().uuid(), nodeId: z.string().max(100), position: z.number().finite().min(0).max(7200), playing: z.boolean() }).strict().parse(req.body);
  const s = mutationSession(req, res); tick(s.watch, body); saveSession(s); res.json({ ok: true });
});
app.post('/api/watch/advance', (req, res) => {
  const body = z.object({ playbackId: z.string().uuid(), choiceKey: z.string().max(150).optional(), qteOutcome: z.enum(['success', 'fail', 'timeout']).optional() }).strict().parse(req.body);
  const s = mutationSession(req, res); advance(s.watch, catalog, body); saveSession(s); res.json(s.watch);
});
app.post('/api/watch/finish', (req, res) => {
  const body = z.object({ playbackId: z.string().uuid() }).strict().parse(req.body);
  const s = mutationSession(req, res); finishNode(s.watch, catalog, body.playbackId); saveSession(s); res.json(s.watch);
});
app.get('/api/subtitles/:episode/:node', (req, res) => { res.json(cues[`${req.params.episode}/${req.params.node}`] ?? []); });
app.get('/api/context/:character', (req, res) => {
  const s = sessionFor(req, res); res.json(storyContext(catalog, cues, s.watch, String(req.params.character)));
});
function conversation(s: Session, characterId: string): Conversation {
  return s.conversations[characterId] ??= { id: randomUUID(), characterId, messages: [] };
}
app.get('/api/chat/:character', (req, res) => {
  const s = sessionFor(req, res); const ctx = storyContext(catalog, cues, s.watch, String(req.params.character));
  const c = conversation(s, ctx.character_id); saveSession(s);
  res.json({ id: c.id, messages: visibleMessages(c.messages, ctx), context: ctx });
});
const streaming = new Set<string>();
app.post('/api/chat/:character/responses', async (req, res) => {
  const body = z.object({ text: z.string().trim().min(1).max(2000), clientRequestId: z.string().uuid() }).strict().parse(req.body);
  const s = mutationSession(req, res); const ctx = storyContext(catalog, cues, s.watch, String(req.params.character));
  const c = conversation(s, ctx.character_id); saveSession(s); const key = `${s.id}/${ctx.character_id}`;
  if (streaming.has(key)) throw new AppError(409, 'Wait for the current reply to finish.');
  const previous = c.messages.find(m => m.id === body.clientRequestId);
  if (previous && previous.text !== body.text) throw new AppError(409, 'This request ID belongs to a different message.');
  const existing = c.messages.find(m => m.id === `${body.clientRequestId}/reply`);
  if (existing && visibleMessages([existing], ctx).length === 0) throw new AppError(409, 'That reply belongs to a later point or a different branch. Send a new message here.');
  const controller = new AbortController(); res.on('close', () => controller.abort());
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache' }); res.flushHeaders();
  const event = (name: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); };
  if (existing) { event('response.completed', { message: existing }); res.end(); return; }
  streaming.add(key);
  try {
    let answer = '';
    const history = visibleMessages(c.messages, ctx);
    event('response.started', { conversationId: c.id });
    for await (const delta of reply(ctx, history, body.text, controller.signal)) { answer += delta; event('response.delta', { text: delta }); }
    if (!answer) throw new AppError(502, 'No reply was returned. Try again.');
    const createdAt = new Date().toISOString();
    const scope = { episode_id: ctx.episode_id, node_id: ctx.node_id, position: ctx.position };
    const assistant: Message = { id: `${body.clientRequestId}/reply`, role: 'assistant', text: answer, evidenceIds: ctx.evidenceIds, createdAt, scope };
    const fresh = findSession(s.id)!; const target = conversation(fresh, ctx.character_id);
    target.messages.push({ id: body.clientRequestId, role: 'user', text: body.text, evidenceIds: ctx.evidenceIds, createdAt, scope }, assistant);
    saveSession(fresh); event('response.completed', { message: assistant });
  } catch (error) {
    if (!controller.signal.aborted) event('response.failed', { message: error instanceof AppError ? error.message : 'The reply was interrupted. Please retry.' });
  } finally { streaming.delete(key); res.end(); }
});
app.get('/api/media/:node', async (req, res) => {
  sessionFor(req, res);
  if (mode !== 'tiktok') throw new AppError(400, 'Platform media is only available in TikTok mode.');
  if (!catalog.episodes.some(ep => ep.graph.nodes.some(n => n.id === req.params.node))) throw new AppError(404, 'Unknown story node.');
  if (!process.env.TIKTOK_MEDIA_MAP_FILE) throw new AppError(503, 'TikTok approved media IDs are not configured.');
  const map = JSON.parse(await fs.readFile(process.env.TIKTOK_MEDIA_MAP_FILE, 'utf8'));
  const video = map[String(req.params.node)];
  if (!video?.album_id || !video?.episode_id || !video?.vid) throw new AppError(503, 'This scene has no approved TikTok media mapping.');
  res.json({ album_id: video.album_id, episode_id: video.episode_id, vid: video.vid, ...(video.play_auth_token ? { play_auth_token: video.play_auth_token } : {}) });
});
app.use('/api', (_req, _res, next) => next(new AppError(404, 'Unknown endpoint.')));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid request fields.' }); return; }
  res.status(error instanceof AppError ? error.status : 500).json({ error: error instanceof AppError ? error.message : 'The local service could not complete this request.' });
});
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist'))); app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares);
}
const port = Number(process.env.PORT ?? 5173);
app.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Mini Drama: http://localhost:${port} | ${mode} | content=${catalog.source} | chat=${provider}`));
