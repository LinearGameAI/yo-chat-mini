import { api } from '../lib/api';
export interface PlayerKernel { currentTime: number; duration: number; paused: boolean; play(): Promise<void> | void; pause(): void }
export interface VeInstance { player?: PlayerKernel; on(event: string, cb: (data?: any) => void): void; destroy(): void }
export interface VeConstructor { new(options: Record<string, unknown>): VeInstance; Events: Record<string, string> }
interface MinisSDK {
  init(options: { clientKey: string }): void;
  login(options: { success(result: { code?: string; authResponse?: { code?: string } }): void; fail(error: unknown): void }): void;
  on(event: 'minis.hide' | 'minis.show', cb: () => void): string;
  off(event: string, callbackId: string): void;
  getPlayer(channel?: 'byteplus' | 'volcengine'): Promise<VeConstructor>;
}
declare global { interface Window { TTMinis?: MinisSDK; __MINI_CLIENT_KEY__?: string; __MINI_SDK_INITIALIZED__?: boolean } }
export async function loginTikTok() {
  if (!window.__MINI_CLIENT_KEY__ || window.__MINI_CLIENT_KEY__.startsWith('local-')) throw new Error('Configure the real TikTok Client Key to use TikTok mode.');
  if (!window.__MINI_SDK_INITIALIZED__) await new Promise<void>((resolve, reject) => {
    const ready = () => { clearTimeout(timeout); resolve(); };
    const timeout = setTimeout(() => { window.removeEventListener('minis-sdk-ready', ready); reject(new Error('The TikTok SDK did not load. Check the network connection.')); }, 12000);
    window.addEventListener('minis-sdk-ready', ready, { once: true });
  });
  const sdk = window.TTMinis;
  if (!sdk || !window.__MINI_CLIENT_KEY__) throw new Error('Configure the TikTok Client Key and open this app through Minis Playground or TikTok.');
  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('TikTok login timed out. Check the test account and debug connection.')), 12000);
    sdk.login({ success: result => { clearTimeout(timeout); const value = result.code ?? result.authResponse?.code; value ? resolve(value) : reject(new Error('TikTok did not return a login code.')); },
      fail: () => { clearTimeout(timeout); reject(new Error('TikTok login was not verified.')); } });
  });
  await api('/auth/tiktok', { code });
}
export function subscribeLifecycle(hide: () => void, show: () => void, platform: boolean) {
  const visibility = () => document.hidden ? hide() : show();
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', hide);
  const sdk = platform ? window.TTMinis : undefined;
  const hideId = sdk?.on('minis.hide', hide); const showId = sdk?.on('minis.show', show);
  return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide);
    if (hideId) sdk?.off('minis.hide', hideId); if (showId) sdk?.off('minis.show', showId); };
}
