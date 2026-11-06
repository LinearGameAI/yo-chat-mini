import { useEffect, useRef, type ReactNode } from 'react';
import type { Catalog, WatchState } from '../../shared/types';
import { Icon } from './Icon';

// DOM ports of ShortDramaCharacters, ShortDramaCastEntry and ShortDramaPlayingBars.
export function PlayingBars() { return <span className="playing-bars" aria-hidden="true"><i /><i /><i /></span>; }

export function CastList({ catalog, onChat }: { catalog: Catalog; onChat(id: string): void }) {
  return <section className="cast-section"><h2>Characters</h2><div className="cast-list">
    {catalog.characters.map(character => <button key={character.id} className="cast-card" aria-label={`Chat with ${character.name}`} onClick={() => onChat(character.id)}>
      <img src={character.image} alt="" /><span className="cast-name">{character.name}</span><span className="cast-chat">Chat</span>
    </button>)}
  </div></section>;
}

export function CastEntry({ catalog, onClick }: { catalog: Catalog; onClick(): void }) {
  if (!catalog.characters.length) return null;
  return <button className="cast-entry" onClick={onClick} aria-label="和角色聊聊">
    <span className="cast-avatars">{catalog.characters.slice(0, 3).map(c => <img key={c.id} src={c.image} alt="" />)}</span>
    <span>和角色聊聊</span>
  </button>;
}

export function EpisodeCells({ catalog, watch, busy, onSelect, horizontal = false }: {
  catalog: Catalog; watch: WatchState; busy?: boolean; onSelect(id: string): void; horizontal?: boolean;
}) {
  return <div className={horizontal ? 'episode-strip' : 'episode-grid'}>{catalog.episodes.map((episode, index) =>
    <button key={episode.id} className={`episode-cell ${episode.id === watch.episodeId ? 'selected' : ''}`} aria-label={`Play ${episode.title}`}
      aria-current={episode.id === watch.episodeId ? 'true' : undefined} disabled={busy} onClick={() => onSelect(episode.id)}>
      {index + 1}{episode.id === watch.episodeId && <PlayingBars />}
    </button>)}{catalog.lockedEpisodes?.map((episode, index) => <button key={episode.id} className="episode-cell locked" disabled aria-label={`${episode.title || `第${catalog.episodes.length + index + 1}集`}，需要解锁`}>{catalog.episodes.length + index + 1}</button>)}</div>;
}

// The shell retains the App's 18px top corners, drag handle and 16px inset.
export function Sheet({ title, onClose, children, className = '' }: { title: string; onClose(): void; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const buttons = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]')];
      const first = buttons[0]; const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="sheet-scrim" onClick={onClose}><section ref={panel} role="dialog" aria-modal="true" aria-label={title} className={`app-sheet ${className}`} onClick={event => event.stopPropagation()}>
    <div className="sheet-handle" /><button className="icon-button sheet-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><Icon name="close" size={18} /></button>
    {children}
  </section></div>;
}
