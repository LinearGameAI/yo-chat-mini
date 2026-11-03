import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { api } from '../lib/api';
import type { VeInstance } from '../platform/tiktok';

export interface MediaHandle { play(): Promise<void>; pause(): void; seek(time: number): void; time(): number; duration(): number; paused(): boolean }
interface Props { mode: 'local' | 'tiktok'; src: string; poster?: string; nodeId: string; start: number; onTime(time: number, duration: number): void; onPlaying(value: boolean): void; onEnded(): void; onError(message: string): void }
export const Media = forwardRef<MediaHandle, Props>(function Media(props, ref) {
  const video = useRef<HTMLVideoElement>(null); const container = useRef<HTMLDivElement>(null); const platform = useRef<VeInstance | null>(null);
  // Loading players report currentTime=0 before they can apply the saved position.
  // Preserve that position if navigation or a lifecycle save happens first.
  const ready = useRef(false); const position = useRef(props.start); const restoring = useRef(props.start > 0);
  const callbacks = useRef(props); callbacks.current = props;
  function currentTime() {
    const value = (props.mode === 'local' ? video.current : platform.current?.player)?.currentTime;
    if (ready.current && typeof value === 'number' && Number.isFinite(value)) {
      if (restoring.current && value < position.current - .25) return position.current;
      restoring.current = false; position.current = value;
    }
    return position.current;
  }
  useImperativeHandle(ref, () => ({
    async play() { await (props.mode === 'local' ? video.current?.play() : platform.current?.player?.play()); },
    pause() { (props.mode === 'local' ? video.current : platform.current?.player)?.pause(); },
    seek(time) { position.current = time; restoring.current = true; const player = props.mode === 'local' ? video.current : platform.current?.player; if (player && ready.current) player.currentTime = time; },
    time: currentTime,
    duration: () => (props.mode === 'local' ? video.current : platform.current?.player)?.duration ?? 0,
    paused: () => (props.mode === 'local' ? video.current : platform.current?.player)?.paused ?? true,
  }), [props.mode]);
  useEffect(() => {
    if (props.mode !== 'tiktok') return;
    let cancelled = false;
    void (async () => {
      try {
        if (!window.TTMinis?.getPlayer) throw new Error('TikTok official player is unavailable. Open through the configured TikTok test environment.');
        const [Ctor, media] = await Promise.all([window.TTMinis.getPlayer('byteplus'), api<{ album_id: string; episode_id: string; vid: string; play_auth_token?: string }>(`/media/${props.nodeId}`)]);
        if (cancelled) return;
        const player = new Ctor({ root: container.current, lang: 'en', vid: media.vid, albumId: media.album_id, episodeId: media.episode_id,
          ...(media.play_auth_token ? { getVideoByToken: { playAuthToken: media.play_auth_token } } : {}) });
        platform.current = player;
        player.on(Ctor.Events.READY, () => { if (player.player) { player.player.currentTime = position.current; ready.current = true; } });
        player.on(Ctor.Events.TIME_UPDATE, () => { if (ready.current) callbacks.current.onTime(currentTime(), player.player?.duration ?? 0); });
        player.on(Ctor.Events.PLAY, () => callbacks.current.onPlaying(true));
        player.on(Ctor.Events.PAUSE, () => callbacks.current.onPlaying(false));
        player.on(Ctor.Events.ENDED, () => callbacks.current.onEnded());
        player.on(Ctor.Events.ERROR, () => callbacks.current.onError('TikTok could not play this approved media. Check its listing status and credentials.'));
      } catch (error) { if (!cancelled) callbacks.current.onError((error as Error).message); }
    })();
    return () => { cancelled = true; platform.current?.destroy(); platform.current = null; };
  }, [props.mode, props.nodeId]);
  if (props.mode === 'tiktok') return <div ref={container} className="media-surface" />;
  return <video ref={video} className="media-surface" src={props.src} poster={props.poster} playsInline preload="metadata"
    onLoadedMetadata={e => { e.currentTarget.currentTime = position.current; ready.current = true; e.currentTarget.dataset.landscape = String(e.currentTarget.videoWidth > e.currentTarget.videoHeight); props.onTime(position.current, e.currentTarget.duration); }}
    onTimeUpdate={e => { if (ready.current) props.onTime(currentTime(), e.currentTarget.duration); }}
    onPlay={() => props.onPlaying(true)} onPause={() => props.onPlaying(false)} onEnded={props.onEnded}
    onError={() => props.onError('The video could not load. Check your internet connection and retry.')} />;
});
