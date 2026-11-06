import { useEffect, useState } from 'react';
import type { Bootstrap, WatchState } from '../shared/types';
import { api } from './lib/api';
import { mainBase } from './lib/yoroll';
import { Player } from './components/Player';
import { Chat } from './components/Chat';
import { DramaDetail } from './components/DramaDetail';
import { DramaList } from './components/DramaList';

function route() { return window.location.hash.slice(1) || 'home'; }
function go(to: string) { window.location.hash = to; }
export default function App() {
  const [data, setData] = useState<Bootstrap>(); const [error, setError] = useState(''); const [page, setPage] = useState(route); const [retry, setRetry] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<string>();
  const params = new URLSearchParams(window.location.search);
  const isHome = page === 'home' && !params.has('drama_id') && !params.has('episode_id') && !params.has('character_id');
  useEffect(() => {
    const listener = () => setPage(route()); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener);
  }, []);
  useEffect(() => {
    if (isHome) return;
    const controller = new AbortController();
    void (async () => {
      let stage = 'bootstrap';
      try {
        let result = await api<Bootstrap>('/bootstrap', undefined, controller.signal);
        if (params.get('drama_id') && params.get('drama_id') !== result.catalog.id) throw new Error('The requested story could not be loaded.');
        const episodeId = params.get('episode_id');
        if (episodeId && !window.sessionStorage.getItem(`entry:${window.location.search}`)) {
          result.watch = await api('/watch/select', { episodeId }); window.sessionStorage.setItem(`entry:${window.location.search}`, '1');
          if (!window.location.hash) go(params.get('character_id') ? 'chat' : 'watch');
        } else if (params.get('character_id') && !window.location.hash) go('chat');
        if (!controller.signal.aborted) setData(result);
      } catch (e) {
        if (!controller.signal.aborted) {
          console.error('[yo-chat-mini] App startup failed', { stage, apiBase: mainBase, pageOrigin: window.location.origin, error: e });
          setError((e as Error).message);
        }
      }
    })(); return () => controller.abort();
  }, [retry, isHome]);
  const updateWatch = (w: WatchState) => setData(d => d ? { ...d, watch: w } : d);
  async function refreshAndGo(to: string) {
    if (to === 'home') { window.location.assign(window.location.pathname); return; }
    try { const fresh = await api<Bootstrap>('/bootstrap'); setData(fresh); go(to); } catch (e) { setError((e as Error).message); }
  }
  if (isHome) return <div className="app-shell"><DramaList /></div>;
  if (!data) return <div className="app-shell"><main className="loading-page">{error ? <><h1>Unable to open this story</h1><p role="alert">{error}</p><button className="primary" onClick={() => { setError(''); setRetry(n => n + 1); }}>Try again</button><button className="secondary" onClick={() => window.location.assign(window.location.pathname)}>返回首页</button></> : <><div className="spinner" /><p role="status">Opening the story…</p></>}</main></div>;
  return <div className="app-shell">
    {page === 'watch' ? <Player key={data.watch.playbackId} data={data} onWatch={updateWatch} onChat={() => void refreshAndGo('detail')} onDetail={() => void refreshAndGo('detail')} onHome={() => void refreshAndGo('home')} />
      : page === 'chat' && data.catalog.characters.length > 0 ? <Chat data={data} initialCharacter={selectedCharacter ?? params.get('character_id') ?? undefined} onBack={() => void refreshAndGo('watch')} />
      : <DramaDetail data={data} onWatch={updateWatch} onPlay={() => go('watch')} onBack={() => go('watch')} onChat={id => { setSelectedCharacter(id); go('chat'); }} />}
  </div>;
}
