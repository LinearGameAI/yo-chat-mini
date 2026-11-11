import { flowLog, flowError } from '../../shared/flow-log';
import { randomUUID } from '../../shared/uuid';
import { throwIfAborted } from '../../shared/abort';
import type { DramaList, Message } from '../../shared/types';
import { createContentClient } from '../../shared/content';
import { resumeYorollConversation, streamYorollReply } from '../../shared/yoroll';
import { startupLog } from './log';
import { loginTikTok } from '../platform/tiktok';
import { loginTikTokPlatform, refreshPlatform, platformRequest, PlatformAuthError, type PlatformTokens } from '../../shared/platform-auth';

export const mainBase = (import.meta.env.VITE_YOROLL_API_BASE_URL || 'https://api.lineargame.ai/api/v1').replace(/\/+$/, '');
export const chatBase = (import.meta.env.VITE_YOROLL_CHAT_BASE_URL || 'https://chat-api.lineargame.ai/api/v1').replace(/\/+$/, '');
export const language = import.meta.env.VITE_YOROLL_CONTENT_LANGUAGE || 'en-US';
const authKey = `yoroll-mini-auth:${mainBase}`;
interface Auth extends PlatformTokens { userId: string }
let auth: Auth | undefined;
let authRevision = 0;
let refreshPromise: Promise<void> | undefined;
try {
  const saved = JSON.parse(sessionStorage.getItem(authKey) || 'null');
  if (typeof saved?.token === 'string' && saved.token && typeof saved?.userId === 'string' && saved.userId) auth = saved;
} catch { /* storage may be disabled */ }
let deviceId: string;
startupLog('API module initializing', { mainBase, chatBase, language, randomUUID: typeof window.crypto?.randomUUID });
try {
  deviceId = localStorage.getItem('yoroll-mini-device') || randomUUID();
  localStorage.setItem('yoroll-mini-device', deviceId);
} catch { deviceId = randomUUID(); }
startupLog('API module ready');
export class LoginRequired extends Error {}
export function isLoggedIn() { return !!auth?.token; }
export function logout() {
  flowLog('Local session cleared');
  authRevision++; refreshPromise = undefined; auth = undefined; conversations.clear();
  try { sessionStorage.removeItem(authKey); } catch { /* optional persistence */ }
}
export function clientHeaders(token?: string): Record<string, string> {
  return { Accept: 'application/json', 'Accept-Language': language, 'X-Client-Type': 'web',
    'X-Client-Platform': 'web', 'X-Client-Version': '0.1.0', 'X-Device-Id': deviceId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
export async function jsonRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const started = Date.now();
  flowLog('Chat JSON request started', { path: new URL(url).pathname, method: options.method || 'GET' });
  const response = await fetch(url, { ...options, credentials: 'omit' });
  flowLog('Chat JSON response received', { status: response.status, elapsedMs: Date.now() - started });
  const data = await response.json().catch(() => { throw new Error(`Yoroll API returned a non-JSON response (HTTP ${response.status}).`); });
  if (!response.ok || data?.error_code || data?.error) {
    const message = data?.error?.message || data?.error_message || (typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`);
    if (response.status === 401 && options.headers && new Headers(options.headers).has('Authorization')) {
      logout(); throw new LoginRequired(message);
    }
    throw new Error(message);
  }
  return data as T;
}
function saveAuth(value: Auth) {
  auth = value;
  try { sessionStorage.setItem(authKey, JSON.stringify(auth)); } catch { /* optional persistence */ }
}
export async function loginWithTikTok(signal?: AbortSignal) {
  const started = Date.now();
  flowLog('TikTok sign-in flow started');
  try {
  const revision = ++authRevision;
  const code = await loginTikTok();
  flowLog('TikTok authorization code obtained');
  throwIfAborted(signal);
  flowLog('Exchanging TikTok code with platform', { mainBase });
  const value = await loginTikTokPlatform(mainBase, code, clientHeaders(), signal);
  if (revision !== authRevision) throw new LoginRequired('Your account changed. Please sign in again.');
  conversations.clear(); saveAuth(value);
  flowLog('TikTok session saved', { elapsedMs: Date.now() - started });
  } catch (error) { flowError('TikTok sign-in flow failed', error, { aborted: !!signal?.aborted, elapsedMs: Date.now() - started }); throw error; }
}
export async function logoutFromPlatform() {
  flowLog('Platform sign-out started');
  const token = auth?.token; logout();
  if (!token) return;
  try { await platformRequest(mainBase, 'users/logout', { method: 'POST', headers: clientHeaders(token) }); flowLog('Platform sign-out completed'); }
  catch (error) { if (!(error instanceof PlatformAuthError && error.status === 401)) throw error; }
}
async function refreshAuth() {
  if (!auth?.refreshToken) { logout(); throw new LoginRequired('Your login has expired. Please sign in again.'); }
  if (refreshPromise) return refreshPromise;
  const current = auth; const revision = authRevision;
  const pending = (async () => {
    try {
      flowLog('Session refresh started');
      const tokens = await refreshPlatform(mainBase, current.refreshToken!, clientHeaders());
      if (revision !== authRevision || auth !== current) throw new LoginRequired('Your account changed. Please sign in again.');
      saveAuth({ ...current, ...tokens });
      flowLog('Session refresh completed');
    } catch (error) {
      flowError('Session refresh failed', error);
      if (revision === authRevision && error instanceof PlatformAuthError && [400, 401, 403].includes(error.status)) {
        logout(); throw new LoginRequired('Your login has expired. Please sign in again.');
      }
      throw error;
    }
  })();
  refreshPromise = pending;
  try { await pending; } finally { if (refreshPromise === pending) refreshPromise = undefined; }
}
async function readyAuth(signal?: AbortSignal) {
  throwIfAborted(signal);
  if (auth?.expiresAt && Date.parse(auth.expiresAt) <= Date.now() + 30000 && auth.refreshToken) await refreshAuth();
  throwIfAborted(signal);
}
export function contentClient(signal?: AbortSignal) { return createContentClient({ baseUrl: mainBase, language, signal }); }
export function fetchDramas(page: number, signal?: AbortSignal): Promise<DramaList> { return contentClient(signal).loadDramaList(page); }
async function chatClient(signal?: AbortSignal) {
  await readyAuth(signal);
  if (!auth?.token) throw new LoginRequired('Sign in with TikTok to chat.');
  return { baseUrl: chatBase, accessToken: auth.token, deviceId, language };
}
const conversations = new Map<string, string>();
function conversationKey(dramaId: string, character: string) {
  if (!auth) throw new LoginRequired('Sign in with TikTok to chat.');
  return JSON.stringify([chatBase, auth.userId, dramaId, character]);
}
async function conversationId(dramaId: string, character: string, signal: AbortSignal) {
  const key = conversationKey(dramaId, character);
  let id = conversations.get(key);
  flowLog('Conversation lookup started', { dramaId, character, memoryHit: !!id });
  if (!id) {
    const client = await chatClient(signal);
    flowLog('Resolving current conversation on server', { character });
    try { id = await resumeYorollConversation(client, character, signal); flowLog('Current conversation resolved'); }
    catch (error) { handleChatError(error); }
    throwIfAborted(signal);
    if (auth?.token !== client.accessToken) throw new LoginRequired('Your Yoroll account changed. Please reopen the conversation.');
    conversations.set(key, id!);
  }
  flowLog('Conversation ready');
  return id!;
}
function handleChatError(error: unknown): never {
  flowError('Chat operation failed', error);
  if (error instanceof Error && 'status' in error && error.status === 401) { logout(); throw new LoginRequired(error.message); }
  throw error;
}
export async function loadConversation(dramaId: string, character: string, signal: AbortSignal): Promise<Message[]> {
  const id = await conversationId(dramaId, character, signal);
  const client = await chatClient(signal);
  const data = await jsonRequest<{ messages: { id: string; text: string; role: string; isFromUser?: boolean; date?: number; blocks?: { type: string; text?: string }[] }[] }>(
    `${chatBase}/conversations/${encodeURIComponent(id)}/messages?limit=100`, { signal, headers: clientHeaders(client.accessToken) });
  flowLog('Conversation messages received', { messageCount: Array.isArray(data.messages) ? data.messages.length : undefined });
  if (!Array.isArray(data.messages)) throw new Error('Yoroll returned invalid conversation messages.');
  return data.messages.map(m => ({ id: m.id, role: m.role === 'user' || m.isFromUser ? 'user' : 'assistant',
    text: m.blocks?.length ? m.blocks.filter(b => ['dialog', 'voiceover', 'thought'].includes(b.type)).map(b => b.text || '').join('\n\n') : m.text || '',
    createdAt: new Date(m.date || Date.now()).toISOString(), evidenceIds: [] }));
}
export async function sendReply(dramaId: string, character: string, text: string, clientRequestId: string,
  onText: (text: string) => void, signal: AbortSignal) {
  try {
    const id = await conversationId(dramaId, character, signal);
    const started = Date.now(); let snapshots = 0;
    flowLog('Chat reply stream started', { clientRequestId });
    for await (const snapshot of streamYorollReply(await chatClient(signal), id, { text, clientRequestId }, signal)) {
      if (++snapshots === 1) flowLog('Chat first text received', { clientRequestId, elapsedMs: Date.now() - started });
      onText(snapshot);
    }
    flowLog('Chat reply stream completed', { clientRequestId, snapshots, elapsedMs: Date.now() - started });
  } catch (error) { handleChatError(error); }
}
