import './env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ContentAccessError, loadContent, loadDramaList } from './content.js';
import { AppError, advance, finishNode, selectEpisode, storyContext, tick, visibleMessages } from './story.js';
import { acquireReplyLock, findSession, loginSession, mapTikTokIdentity, newSession, releaseReplyLock, saveConversation, updateWatch } from './store.js';
import { chatProvider, reply } from './chat.js';
import { createYorollConversation, requireYorollAuth, streamYorollReply } from './yoroll.js';
import { DRAMA_ID, type Session, type Message, type Conversation, type Catalog, type CueMap } from '../shared/types.js';

// Explicit browser debugging overrides a TikTok mode inherited from the Playground.
const localDebug = process.argv.includes('--local') && process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
const mode = !localDebug && process.env.APP_MODE === 'tiktok' ? 'tiktok' : 'local';
const provider = chatProvider();
const contentCache = new Map<string, Promise<{ catalog: Catalog; cues: CueMap }>>();
const app = express();
app.disable('x-powered-by'); app.use(express.json({ limit: '20kb' }));
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(v => v.trim()).filter(Boolean));
for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
  if (host) allowedOrigins.add(`https://${host}`);
}
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  // TikTok Minis use per-preview HTTPS origins under tiktok-minis.us. Reflect
  // only those trusted platform origins (never use '*' with credentialed API calls).
  const isTikTokMiniOrigin = !!origin && /^https:\/\/[a-z0-9-]+\.tiktok-minis\.us$/i.test(origin);
  if (origin && !allowedOrigins.has(origin) && !isTikTokMiniOrigin) { res.status(403).json({ error: 'This application origin is not allowed.' }); return; }
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.vary('Origin'); }
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Drama-Id'); res.sendStatus(204); return; }
  next();
});
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
function cookieName(res: Response) { return `yoroll_mini_session${res.locals.catalog.id === DRAMA_ID ? '' : `_${res.locals.catalog.id}`}`; }
function cookieId(req: Request, res: Response) { const name = cookieName(res); return req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1); }
function setCookie(res: Response, id: string) {
  const crossSite = mode === 'tiktok' && process.env.COOKIE_CROSS_SITE === 'true';
  res.cookie(cookieName(res), id, { httpOnly: true, sameSite: crossSite ? 'none' : 'lax', secure: crossSite || !!process.env.VERCEL || (mode === 'tiktok' && process.env.NODE_ENV === 'production'), maxAge: 30 * 86400000, path: '/' });
}
async function sessionFor(req: Request, res: Response): Promise<Session> {
  const { catalog } = res.locals;
  let s = await findSession(cookieId(req, res));
  if (s && (s.dramaId ?? DRAMA_ID) !== catalog.id) s = undefined;
  if (s && s.identity !== mode) s = undefined;
  if (!s && mode === 'local') { s = await newSession(catalog, 'local'); setCookie(res, s.id); }
  if (!s) throw new AppError(401, 'TikTok login is required.');
  return s;
}
async function mutationSession(req: Request, res: Response) {
  const s = await sessionFor(req, res);
  if (req.headers['x-csrf-token'] !== s.csrf) throw new AppError(403, 'Reload this page before continuing.');
  return s;
}
app.get('/api/health', (_req, res) => res.json({ ok: true, mode, contentSource: 'live', contentLoaded: contentCache.size > 0, chatProvider: provider }));
// The public homepage needs only the feed, not a story graph, subtitles or a session.
app.get('/api/dramas', async (req, res) => {
  const page = z.coerce.number().int().min(1).max(10000).parse(req.query.page ?? 1);
  try { res.json(await loadDramaList(page)); }
  catch { throw new AppError(503, '短剧列表加载失败，请稍后重试。'); }
});
// A failed upstream load must leave the API running so the page's retry can try again.
// Share concurrent loads and retain only successful online content in process memory.
app.use('/api', async (req, res, next) => {
  const dramaId = req.get('X-Drama-Id') ?? DRAMA_ID;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(dramaId)) { next(new AppError(400, 'Invalid drama ID.')); return; }
  try {
    let loading = contentCache.get(dramaId);
    if (!loading) {
      loading = loadContent(dramaId).catch(error => { contentCache.delete(dramaId); throw error; });
      contentCache.set(dramaId, loading);
    }
    const content = await loading;
    Object.assign(res.locals, content);
    next();
  } catch (error) {
    if (error instanceof ContentAccessError) { next(new AppError(403, error.message)); return; }
    console.error('Yoroll content load failed:', error);
    next(new AppError(503, 'The Yoroll story could not be loaded from the online service. Please try again.'));
  }
});
app.get('/api/bootstrap', async (req, res) => {
  const { catalog } = res.locals;
  let s: Session | undefined;
  try { s = await sessionFor(req, res); } catch (error) {
    if (!(error instanceof AppError && error.status === 401)) throw error;
  }
  res.json({ catalog, mode, chatProvider: provider, authenticated: !!s, csrf: s?.csrf, watch: s?.watch });
});
app.post('/api/auth/tiktok', async (req, res) => {
  const { catalog } = res.locals;
  if (mode !== 'tiktok') throw new AppError(400, 'TikTok login is disabled in local mode.');
  const { code } = z.object({ code: z.string().min(1).max(2048) }).strict().parse(req.body);
  const clientKey = process.env.TIKTOK_CLIENT_KEY; const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !secret) throw new AppError(503, 'Server TikTok credentials are not configured.');
  const result = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: clientKey, client_secret: secret, code, grant_type: 'authorization_code' }) });
  const data = await result.json();
  if (!result.ok || typeof data.open_id !== 'string' || !data.access_token) throw new AppError(401, 'TikTok could not verify this login.');
  // Never return or log upstream tokens. Identity mapping stays in this independent adapter.
  const s = await loginSession(catalog, await mapTikTokIdentity(clientKey, data.open_id));
  setCookie(res, s.id); res.json({ ok: true });
});
app.post('/api/watch/select', async (req, res) => {
  const { catalog } = res.locals;
  const body = z.object({ episodeId: z.string().max(100), restart: z.boolean().optional() }).strict().parse(req.body);
  const s = await mutationSession(req, res); res.json(await updateWatch(s, watch => selectEpisode(watch, catalog, body.episodeId, body.restart)));
});
app.post('/api/watch/tick', async (req, res) => {
  const body = z.object({ playbackId: z.string().uuid(), nodeId: z.string().max(100), position: z.number().finite().min(0).max(7200), playing: z.boolean() }).strict().parse(req.body);
  const s = await mutationSession(req, res); await updateWatch(s, watch => tick(watch, body)); res.json({ ok: true });
});
app.post('/api/watch/advance', async (req, res) => {
  const { catalog } = res.locals;
  const body = z.object({ playbackId: z.string().uuid(), choiceKey: z.string().max(150).optional(), qteOutcome: z.enum(['success', 'fail', 'timeout']).optional() }).strict().parse(req.body);
  const s = await mutationSession(req, res); res.json(await updateWatch(s, watch => advance(watch, catalog, body)));
});
app.post('/api/watch/finish', async (req, res) => {
  const { catalog } = res.locals;
  const body = z.object({ playbackId: z.string().uuid() }).strict().parse(req.body);
  const s = await mutationSession(req, res); res.json(await updateWatch(s, watch => finishNode(watch, catalog, body.playbackId)));
});
app.get('/api/subtitles/:episode/:node', (req, res) => { res.json(res.locals.cues[`${req.params.episode}/${req.params.node}`] ?? []); });
app.get('/api/context/:character', async (req, res) => {
  const { catalog, cues } = res.locals;
  const s = await sessionFor(req, res); res.json(storyContext(catalog, cues, s.watch, String(req.params.character)));
});
function conversation(s: Session, characterId: string): Conversation {
  return s.conversations[characterId] ??= { id: randomUUID(), characterId, messages: [] };
}
app.get('/api/chat/:character', async (req, res) => {
  const { catalog, cues } = res.locals;
  const s = await sessionFor(req, res); const ctx = storyContext(catalog, cues, s.watch, String(req.params.character));
  conversation(s, ctx.character_id); const c = await saveConversation(s, ctx.character_id, true);
  res.json({ id: c.id, messages: visibleMessages(c.messages, ctx), context: ctx });
});
app.post('/api/chat/:character/responses', async (req, res) => {
  const { catalog, cues } = res.locals;
  const body = z.object({ text: z.string().trim().min(1).max(2000), clientRequestId: z.string().uuid() }).strict().parse(req.body);
  const initial = await mutationSession(req, res); const key = `${initial.id}/${String(req.params.character)}`;
  const lock = await acquireReplyLock(key);
  if (!lock) throw new AppError(409, 'Wait for the current reply to finish.');
  try {
    const s = await findSession(initial.id);
    if (!s) throw new AppError(401, 'Reload this page before continuing.');
    const ctx = storyContext(catalog, cues, s.watch, String(req.params.character));
    conversation(s, ctx.character_id); const c = await saveConversation(s, ctx.character_id, true);
    const previous = c.messages.find(m => m.id === body.clientRequestId);
    if (previous && previous.text !== body.text) throw new AppError(409, 'This request ID belongs to a different message.');
    const existing = c.messages.find(m => m.id === `${body.clientRequestId}/reply`);
    if (existing && visibleMessages([existing], ctx).length === 0) throw new AppError(409, 'That reply belongs to a later point or a different branch. Send a new message here.');
    const yorollAuth = provider === 'yoroll' && !existing ? requireYorollAuth(s) : undefined;
    const controller = new AbortController(); res.on('close', () => controller.abort());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(110_000)]);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache' }); res.flushHeaders();
    const event = (name: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); };
    if (existing) { event('response.completed', { message: existing }); return; }
    try {
      let answer = '';
      const history = visibleMessages(c.messages, ctx);
      event('response.started', { conversationId: c.id });
      if (yorollAuth) {
        const client = { baseUrl: process.env.YOROLL_CHAT_BASE_URL || 'https://chat-api.lineargame.ai/api/v1',
          accessToken: yorollAuth.accessToken, deviceId: s.id, language: req.get('accept-language') };
        const historyIds = history.map(message => message.id);
        // Rewinds/branch changes must not resume remote history hidden by local filtering.
        if (!c.yoroll || c.yoroll.baseUrl !== client.baseUrl || c.yoroll.userId !== yorollAuth.userId ||
          JSON.stringify(c.yoroll.historyIds) !== JSON.stringify(historyIds)) {
          c.yoroll = { id: await createYorollConversation(client, ctx.character_id, signal),
            baseUrl: client.baseUrl, userId: yorollAuth.userId, historyIds };
          // Persist before streaming so retries reuse the conversation and clientRequestId.
          s.conversations[ctx.character_id] = c;
          await saveConversation(s, ctx.character_id);
        }
        for await (const snapshot of streamYorollReply(client, c.yoroll.id,
          { text: body.text, clientRequestId: body.clientRequestId, ...(process.env.CHAT_MODEL ? { model: process.env.CHAT_MODEL } : {}) }, signal)) {
          answer = snapshot; event('response.delta', { text: snapshot, replace: true });
        }
      } else {
        for await (const delta of reply(ctx, history, body.text, signal)) { answer += delta; event('response.delta', { text: delta }); }
      }
      if (!answer) throw new AppError(502, 'No reply was returned. Try again.');
      const createdAt = new Date().toISOString();
      const scope = { episode_id: ctx.episode_id, node_id: ctx.node_id, position: ctx.position };
      const assistant: Message = { id: `${body.clientRequestId}/reply`, role: 'assistant', text: answer, evidenceIds: ctx.evidenceIds, createdAt, scope };
      const fresh = await findSession(s.id);
      if (!fresh) throw new AppError(401, 'Reload this page before continuing.');
      const target = conversation(fresh, ctx.character_id);
      target.messages.push({ id: body.clientRequestId, role: 'user', text: body.text, evidenceIds: ctx.evidenceIds, createdAt, scope }, assistant);
      if (yorollAuth && c.yoroll) target.yoroll = { ...c.yoroll, historyIds: [...history.map(message => message.id), body.clientRequestId, assistant.id] };
      await saveConversation(fresh, ctx.character_id); event('response.completed', { message: assistant });
    } catch (error) {
      if (!controller.signal.aborted) event('response.failed', { message: error instanceof AppError ? error.message : 'The reply was interrupted. Please retry.' });
    }
  } finally {
    // Keep the response open until cleanup finishes; serverless instances may stop after end().
    try { await releaseReplyLock(key, lock); }
    finally { if (res.headersSent && !res.writableEnded) res.end(); }
  }
});
app.get('/api/media/:node', async (req, res) => {
  const { catalog } = res.locals as { catalog: Catalog };
  await sessionFor(req, res);
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
  if (!(error instanceof AppError)) console.error('Mini Drama request failed:', error);
  res.status(error instanceof AppError ? error.status : 500).json({ error: error instanceof AppError ? error.message : 'The local service could not complete this request.' });
});
if (!process.env.VERCEL && process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist'))); app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
} else if (!process.env.VERCEL) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares);
}
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 5173);
  app.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Mini Drama: http://localhost:${port} | ${mode} | content=live | chat=${provider}`));
}
export default app;
