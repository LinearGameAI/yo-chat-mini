import { useState } from 'react';
import type { Bootstrap, WatchState } from '../../shared/types';
import { api } from '../lib/api';
import { CastList, EpisodeCells } from './DramaUI';
import { Icon } from './Icon';

// Layout and sizing ported from Yoroll's ShortDramaDetailScreen.tsx.
export function DramaDetail({ data, onWatch, onPlay, onChat, onBack }: { data: Bootstrap; onWatch(w: WatchState): void; onPlay(): void; onChat(id?: string): void; onBack(): void }) {
  const { catalog, watch } = data; const [expanded, setExpanded] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const progress = watch.episodes[watch.episodeId];
  const hasProgress = progress.position > 1 || progress.path.length > 1 || Object.keys(watch.episodes).length > 1;
  async function select(episodeId: string) {
    setBusy(true); setError('');
    try { onWatch(await api('/watch/select', { episodeId })); onPlay(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="detail-page">
    <div className="detail-ambient" aria-hidden="true"><img src={catalog.cover} alt="" /></div>
    <button className="icon-button detail-back" aria-label="返回视频" onClick={onBack}><Icon name="back" /></button>
    <div className="detail-scroll">
      <header className="detail-header"><img className="detail-cover" src={catalog.cover} alt={`${catalog.title} cover`} /><h1>{catalog.title}</h1>
        <p className="detail-meta">{catalog.totalEpisodes ?? catalog.episodes.length} episodes{catalog.tags.filter(t => t !== 'interactive_drama').map(tag => ` · ${tag}`).join('')}</p>
      </header>
      <section className="detail-section"><h2>Synopsis</h2><div className={`synopsis ${expanded ? 'expanded' : ''}`}><p>{catalog.description}</p><button className="synopsis-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? 'Less' : 'More'}</button></div></section>
      {catalog.characters.length > 0 && <CastList catalog={catalog} onChat={onChat} />}
      <section className="detail-section"><h2>Episodes</h2><EpisodeCells catalog={catalog} watch={watch} onSelect={id => void select(id)} busy={busy} horizontal /></section>
      <p className="data-notice">Original Yoroll story · {data.chatProvider === 'mock' ? 'Mock chat preview' : 'AI character chat'}</p>
    </div>
    <footer className="detail-actions">{error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy} onClick={onPlay}><Icon name="play" size={18} />{hasProgress ? 'Continue Watching' : 'Start Watching'}</button>
      {catalog.characters.length > 0 && <button className="text-button" onClick={() => onChat()}>Chat with Characters <Icon name="chat" size={18} /></button>}
    </footer>
  </main>;
}
