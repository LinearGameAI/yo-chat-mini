import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Bootstrap, WatchState } from '../../shared/types';
import { choiceCountdownSeconds, nodeVideoUrl, type ChapterGraph } from '../../shared/drama';
import { findCue, type SubtitleCue } from '../../shared/subtitles';
import { DramaChatPromptSession } from '../../shared/promptSession';
import { playbackLifecycle } from '../../shared/playbackLifecycle';
import { api, keepProgress } from '../lib/api';
import { subscribeLifecycle } from '../platform/tiktok';
import { Media, type MediaHandle } from './Media';
import { Icon } from './Icon';
import { CastEntry, EpisodeCells, Sheet } from './DramaUI';
import { DramaPlayerIcon } from './DramaPlayerIcon';

// Same display order as ShortDramaScreen. The published nodes array need not start at the first scene.
function orderedStageNodes(graph: ChapterGraph) {
  const start = graph.nodes.find(node => node.id === graph.startNodeId);
  const rest = graph.nodes.filter(node => node.id !== graph.startNodeId);
  const isEnding = (node: ChapterGraph['nodes'][number]) => !(node.choices?.length || node.qte || node.next);
  return [...(start ? [start] : []), ...rest.filter(node => !isEnding(node)), ...rest.filter(isEnding)];
}

export const timestamp = (n: number) => `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, '0')}`;
export function Player({ data, onWatch, onChat, onHome, onDetail }: { data: Bootstrap; onWatch(w: WatchState): void; onChat(): void; onHome(): void; onDetail(): void }) {
  const { catalog, watch, mode } = data; const ep = catalog.episodes.find(e => e.id === watch.episodeId)!;
  const progress = watch.episodes[ep.id]; const node = ep.graph.nodes.find(n => n.id === progress.nodeId)!;
  const media = useRef<MediaHandle>(null); const [time, setTime] = useState(progress.position); const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false); const [ended, setEnded] = useState(progress.ended || !!progress.pendingInteraction);
  const [chapters, setChapters] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [cues, setCues] = useState<SubtitleCue[]>([]); const [countdown, setCountdown] = useState(0); const [hint, setHint] = useState(false);
  const queue = useRef(Promise.resolve()); const prompt = useRef(new DramaChatPromptSession()); const active = useRef(true); const latestTime = useRef(progress.position);
  const body = (playingOverride?: boolean) => ({ playbackId: watch.playbackId, nodeId: node.id, position: media.current?.time() ?? latestTime.current, playing: playingOverride ?? !(media.current?.paused() ?? true) });
  function sync(playingOverride?: boolean) {
    const payload = body(playingOverride);
    queue.current = queue.current.catch(() => {}).then(async () => { await api('/watch/tick', payload); });
    return queue.current;
  }
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void api<SubtitleCue[]>(`/subtitles/${ep.id}/${node.id}`, undefined, controller.signal).then(setCues).catch(() => {});
    const interval = setInterval(() => {
      if (!media.current?.paused()) void sync().catch(e => { if (active.current) setError(e.message); });
      prompt.current.update(performance.now(), !media.current?.paused());
      if (prompt.current.claim()) setHint(true);
    }, 1000);
    const lifecycle = playbackLifecycle({ isPlaying: () => !media.current?.paused(), pause: () => media.current?.pause(),
      save: () => keepProgress(body(false)), play: () => { void media.current?.play().catch(() => {}); } });
    const unsubscribe = subscribeLifecycle(lifecycle.hide, lifecycle.show, mode === 'tiktok');
    return () => { active.current = false; clearInterval(interval); controller.abort(); unsubscribe(); keepProgress(body(false)); };
  }, [watch.playbackId]);
  async function transition(choiceKey?: string, qteOutcome?: 'success' | 'fail' | 'timeout') {
    if (busy) return; setBusy(true); setError('');
    try { await sync(false); const w = await api<WatchState>('/watch/advance', { playbackId: watch.playbackId, choiceKey, qteOutcome }); onWatch(w); setEnded(w.episodes[w.episodeId].ended); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function finish() {
    setPlaying(false); setBusy(true);
    try { await sync(false); const w = await api<WatchState>('/watch/finish', { playbackId: watch.playbackId }); onWatch(w); setEnded(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!ended || progress.ended) return;
    const seconds = node.qte?.duration ?? choiceCountdownSeconds(node);
    if (!seconds) return;
    const started = Date.now(); setCountdown(seconds);
    const id = setInterval(() => {
      const remaining = Math.max(0, seconds - (Date.now() - started) / 1000); setCountdown(remaining);
      if (remaining <= 0) { clearInterval(id); if (node.qte) void transition(undefined, 'timeout'); else {
        const choice = node.choices?.find(c => c.key === node.defaultChoice); if (choice) void transition(choice.key);
      } }
    }, 100);
    return () => clearInterval(id);
  }, [ended, node.id]);
  async function navigate(action: () => void) {
    media.current?.pause(); try { await sync(false); action(); } catch (e) { setError((e as Error).message); }
  }
  async function select(episodeId: string, restart = false) {
    setBusy(true);
    try { await sync(false); onWatch(await api('/watch/select', { episodeId, restart })); setChapters(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const cue = findCue(cues, time * 1000); const index = catalog.episodes.indexOf(ep);
  const showChoices = ended && !progress.ended && (!!node.choices?.length || !!node.qte);
  return <main className="player-page">
    <Media ref={media} mode={mode} src={nodeVideoUrl(ep.graph.cdnBase, node)} nodeId={node.id} poster={node.coverImage} start={progress.position}
      onTime={(t, d) => {
        latestTime.current = t; setTime(t); if (Number.isFinite(d)) setDuration(d);
        if (Math.abs(t - progress.position) > 0.2) onWatch({ ...watch, episodes: { ...watch.episodes, [ep.id]: { ...progress, position: t } } });
      }} onPlaying={value => { setPlaying(value); void sync(value).catch(() => {}); }} onEnded={() => void finish()} onError={setError} />
    <div className="player-shade" />
    <header className="player-top"><button className="icon-button" aria-label="返回首页" onClick={() => void navigate(onHome)}><Icon name="back" size={18} /></button><span>第{index + 1}集</span></header>
    {!showChoices && !progress.ended && <button className={`play-toggle ${playing ? 'is-playing' : ''}`} aria-label={playing ? 'Pause video' : 'Play video'} onClick={() => {
      if (playing) media.current?.pause(); else { setError(''); void media.current?.play().catch(() => setError('Tap play again to start playback.')); }
    }}><DramaPlayerIcon name="play" size={44} /></button>}
    {cue && !showChoices && <div className="subtitle">{cue.text}</div>}
    {showChoices && <section className="choice-panel" aria-label="Story choices"><p>{node.question || (node.qte ? 'React before time runs out' : 'Choose your next move')}{countdown > 0 && <span className="choice-time">{Math.ceil(countdown)}s</span>}</p>
      <div className="choice-options">{node.choices?.map(c => <button key={c.key} disabled={busy} className="choice-button" onClick={() => void transition(c.key)}><span>{c.label}</span></button>)}</div>
      {node.qte && <button className="qte-button" disabled={busy} onClick={() => void transition(undefined, 'success')}>Tap now</button>}
    </section>}
    {progress.ended && <section className="ending-panel"><h2>{node.endType === 'death' ? 'This path ends here' : index === catalog.episodes.length - 1 ? 'The end' : 'End of episode'}</h2>{node.endDesc && <p>{node.endDesc}</p>}
      {index < catalog.episodes.length - 1 && node.endType !== 'death' && <button className="primary" onClick={() => void select(catalog.episodes[index + 1].id)}>Next episode <Icon name="next" /></button>}
      <button className="secondary" onClick={() => void select(ep.id, true)}><Icon name="restart" size={18} /> Replay episode</button></section>}
    <div className="player-caption">
      {error && <div className="error" role="alert">{error}</div>}
      <button className="player-title" onClick={() => void navigate(onDetail)}><h1>{catalog.title}</h1><Icon name="next" size={15} /></button>
      {catalog.characters.length > 0 && <div className="player-cast" title={hint ? 'Talk about the moment you just watched' : undefined}><CastEntry catalog={catalog} onClick={() => void navigate(onChat)} /></div>}
    </div>
    <button className="episodes-bar" aria-label="Open episodes" onClick={() => { media.current?.pause(); setChapters(true); }}>
      <img src={catalog.cover || ep.cover} alt="" /><span>选集 · {catalog.finished === false ? '更新中' : '已完结'} · 共{catalog.totalEpisodes ?? catalog.episodes.length}集</span><Icon name="next" size={16} /></button>
    <div className="seek-line" style={{ '--played': `${duration ? Math.min(100, time / duration * 100) : 0}%` } as CSSProperties}>
      <input aria-label="Playback position" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(time, duration || 1)} onChange={e => { media.current?.seek(Number(e.target.value)); setTime(Number(e.target.value)); void sync().catch(() => {}); }} />
      <span className="seek-time">{timestamp(time)} / {timestamp(duration)}</span>
    </div>
    <footer className="player-band"><div className="episode-navigation">
      <button disabled={index === 0 || busy} onClick={() => void select(catalog.episodes[index - 1].id)} aria-label="Previous episode"><Icon name="back" size={18} /></button>
      <span>{index + 1} / {catalog.episodes.length}</span><button disabled={index === catalog.episodes.length - 1 || busy} onClick={() => void select(catalog.episodes[index + 1].id)} aria-label="Next episode"><Icon name="next" size={18} /></button>
    </div><div className="band-right"><span className="player-pill">Stage {orderedStageNodes(ep.graph).findIndex(n => n.id === node.id) + 1}</span></div></footer>
    {chapters && <Sheet title="Episodes" onClose={() => setChapters(false)} className="episode-sheet">
      <header className="sheet-drama-header"><img src={catalog.cover} alt="" /><div><h2>{catalog.title}</h2><p>{catalog.episodes.length} episodes</p><div className="sheet-tags">{catalog.tags.filter(t => t !== 'interactive_drama').slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div></div></header>
      <h3 className="sheet-section-title">Episodes</h3><EpisodeCells catalog={catalog} watch={watch} busy={busy} onSelect={id => void select(id)} />
      {!!catalog.lockedEpisodes?.length && <p className="locked-notice">后续章节需要会员或解锁后观看。</p>}
    </Sheet>}
  </main>;
}
