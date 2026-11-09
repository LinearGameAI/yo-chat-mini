import { throwIfAborted, timedSignal } from './abort.js';

export interface PlatformTokens { token: string; refreshToken?: string; expiresAt?: string }
export interface PlatformLogin extends PlatformTokens { userId: string }

export function platformTokens(data: unknown): PlatformTokens {
  const value = data as { token?: unknown; refresh_token?: unknown; expires_at?: unknown } | null;
  if (typeof value?.token !== 'string' || !value.token) throw new Error('The platform did not return a login token.');
  return { token: value.token,
    refreshToken: typeof value.refresh_token === 'string' && value.refresh_token ? value.refresh_token : undefined,
    expiresAt: typeof value.expires_at === 'string' && Number.isFinite(Date.parse(value.expires_at)) ? value.expires_at : undefined };
}

export class PlatformAuthError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function platformRequest(base: string, path: string, options: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const url = new URL(`${base.replace(/\/+$/, '')}/${path}`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Platform authentication requires HTTPS.');
  const timeout = timedSignal(signal, 20000);
  try {
  const response = await fetch(url, { ...options, redirect: 'error', credentials: 'omit', signal: timeout.signal });
  if (response.status === 204) return undefined;
  const data = await response.json().catch(() => { throw new PlatformAuthError('The authentication service returned an invalid response.', response.status); });
  if (!response.ok || data?.error_code || data?.error) {
    throw new PlatformAuthError(data?.error_message || data?.error?.message || 'Platform sign-in failed. Please try again.', response.status);
  }
  return data;
  } finally { timeout.dispose(); }
}

export async function loginTikTokPlatform(base: string, code: string, headers: Record<string, string>, signal?: AbortSignal): Promise<PlatformLogin> {
  if (!code.trim() || code.length > 2048) throw new Error('TikTok did not return a valid login code.');
  throwIfAborted(signal);
  const tokens = platformTokens(await platformRequest(base, 'users/oauth/tiktok/login', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  }, signal));
  if (!tokens.refreshToken) throw new Error('The platform did not return a refresh token.');
  const me = await platformRequest(base, 'users/me', { headers: { ...headers, Authorization: `Bearer ${tokens.token}` } }, signal) as { id?: unknown };
  if (typeof me?.id !== 'string' || !me.id) throw new Error('The platform did not return a user identity.');
  throwIfAborted(signal);
  return { ...tokens, userId: me.id };
}

export async function refreshPlatform(base: string, refreshToken: string, headers: Record<string, string>): Promise<PlatformTokens> {
  return platformTokens(await platformRequest(base, 'users/token/refresh', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }),
  }));
}
