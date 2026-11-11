import { flowLog, flowError } from '../../shared/flow-log';

export interface PlayerKernel { currentTime: number; duration: number; paused: boolean; play(): Promise<void> | void; pause(): void }
export interface VeInstance { player?: PlayerKernel; on(event: string, cb: (data?: any) => void): void; destroy(): void }
export interface VeConstructor { new(options: Record<string, unknown>): VeInstance; Events: Record<string, string> }
interface MinisSDK {
  init(options: { clientKey: string }): void;
  login(callback: (result: { code?: string; authResponse?: { code?: string }; error?: { error_code?: number; error_msg?: string; code?: number; msg?: string } }) => void): void;
  on(event: 'minis.hide' | 'minis.show', cb: () => void): string;
  off(event: string, callbackId: string): void;
  getPlayer(channel?: 'byteplus' | 'volcengine'): Promise<VeConstructor>;
  getMenuButtonBoundingClientRect?(): { top: number; right: number; bottom: number; left: number; width: number; height: number };
}
declare global { interface Window { TTMinis?: MinisSDK; __MINI_CLIENT_KEY__?: string; __MINI_SDK_INITIALIZED__?: boolean } }
export async function loginTikTok() {
  const started = Date.now();
  flowLog('TikTok SDK login started', { sdkPresent: !!window.TTMinis, initialized: !!window.__MINI_SDK_INITIALIZED__, clientKeyConfigured: !!window.__MINI_CLIENT_KEY__ });
  try {
  if (!window.__MINI_CLIENT_KEY__ || window.__MINI_CLIENT_KEY__.startsWith('local-') || !/^[A-Za-z0-9_-]+$/.test(window.__MINI_CLIENT_KEY__)) throw new Error('Configure the real TikTok Client Key to use TikTok mode.');
  if (!window.__MINI_SDK_INITIALIZED__) await new Promise<void>((resolve, reject) => {
    const ready = () => { clearTimeout(timeout); flowLog('TikTok SDK ready', { elapsedMs: Date.now() - started }); resolve(); };
    const timeout = setTimeout(() => { window.removeEventListener('minis-sdk-ready', ready); flowLog('TikTok SDK readiness timed out', { timeoutMs: 12000 }); reject(new Error('The TikTok SDK did not load. Check the network connection.')); }, 12000);
    flowLog('Waiting for TikTok SDK ready', { timeoutMs: 12000 });
    window.addEventListener('minis-sdk-ready', ready, { once: true });
  });
  const sdk = window.TTMinis;
  if (!sdk || !window.__MINI_CLIENT_KEY__) throw new Error('Configure the TikTok Client Key and open this app through Minis Playground or TikTok.');
  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { flowLog('TikTok SDK login callback timed out', { timeoutMs: 35000 }); reject(new Error('TikTok login timed out without an SDK callback. Check the test account, app login configuration, and debug connection.')); }, 35000);
    try {
      // The hosted drama/sdk.js currently accepts a callback and returns authResponse.code.
      flowLog('Calling TikTok SDK login', { timeoutMs: 35000 });
      sdk.login(result => {
        clearTimeout(timeout);
        const value = result?.authResponse?.code ?? result?.code;
        flowLog('TikTok SDK login callback received', { hasCode: !!value, errorCode: result?.error?.error_code ?? result?.error?.code, elapsedMs: Date.now() - started });
        if (value) { resolve(value); return; }
        const error = result?.error;
        reject(new Error(error?.error_msg || error?.msg || `TikTok login failed (${error?.error_code ?? error?.code ?? 'no code returned'}).`));
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
  // A TikTok code is not a Yoroll bearer token. Only return it to an explicit caller.
  flowLog('TikTok SDK login completed', { elapsedMs: Date.now() - started });
  return code;
  } catch (error) { flowError('TikTok SDK login failed', error, { elapsedMs: Date.now() - started }); throw error; }
}
export function subscribeLifecycle(hide: () => void, show: () => void, platform: boolean) {
  const visibility = () => document.hidden ? hide() : show();
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', hide);
  const sdk = platform ? window.TTMinis : undefined;
  const hideId = sdk?.on('minis.hide', hide); const showId = sdk?.on('minis.show', show);
  return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide);
    if (hideId) sdk?.off('minis.hide', hideId); if (showId) sdk?.off('minis.show', showId); };
}
