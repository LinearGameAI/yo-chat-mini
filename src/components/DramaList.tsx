import { useEffect, useRef, useState } from 'react';
import type { DramaListItem } from '../../shared/types';
import { fetchDramas } from '../lib/yoroll';
import { startupLog, errorDetails } from '../lib/log';

function playCount(count: number) {
  const value = Number.isFinite(count) ? Math.max(0, count) : 0;
  return value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(value);
}

export function DramaList() {
  const [items, setItems] = useState<DramaListItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);

  async function load(nextPage: number) {
    const started = Date.now();
    startupLog('Homepage load started', { page: nextPage });
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    try {
      const data = await fetchDramas(nextPage, controller.signal);
      if (controller.signal.aborted) return;
      startupLog('Homepage feed received', { page: data.page, count: data.items.length, total: data.total, elapsedMs: Date.now() - started });
      setItems(previous => [...new Map([...previous, ...data.items].map(item => [item.game_id, item])).values()]);
      setLoaded(previous => previous + data.items.length);
      setPage(data.page); setTotal(data.total);
    } catch (e) {
      startupLog(controller.signal.aborted ? 'Homepage load aborted' : 'Homepage load failed', { page: nextPage, elapsedMs: Date.now() - started, ...errorDetails(e) }, controller.signal.aborted ? 'info' : 'error');
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => { startupLog('Homepage mounted'); void load(1); return () => request.current?.abort(); }, []);
  useEffect(() => {
    startupLog('Homepage rendered', { page, cardCount: items.length, total, loading, hasError: !!error });
  }, [page, items.length, total, loading, error]);

  return <main className="drama-list-page">
    <header className="drama-list-header"><h1 className="drama-list-brand">yoroll <span>game</span></h1></header>
    <ul className="drama-list" aria-label="互动短剧" aria-busy={loading}>
      {items.map(item => <li key={item.game_id} className="drama-list-card">
        <a className="drama-list-link" href={`?drama_id=${encodeURIComponent(item.game_id)}#watch`} aria-label={`观看${item.title}`}><div className="drama-list-cover">{(item.cover_image || item.portrait_cover_image) && <img src={item.cover_image || item.portrait_cover_image} alt="" loading="lazy" />}</div>
        <h2>{item.has_membership_content ? <span className="drama-list-badge">会员</span> : item.has_paid_content ? <span className="drama-list-badge">付费</span> : null}{item.title}</h2>
        <p>{[`${playCount(item.display_count)}次播放`, ...String(item.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean)].join(' · ')}</p></a>
      </li>)}
    </ul>
    <div className="drama-list-status">
      {loading && <p role="status">正在加载短剧…</p>}
      {error && <><p role="alert">{error}</p><button className="secondary" onClick={() => void load(page + 1)}>重试</button></>}
      {!loading && !error && (items.length === 0 ? <p>暂无互动短剧</p> : loaded < total
        ? <button className="secondary" onClick={() => void load(page + 1)}>加载更多</button> : <p>已加载全部短剧</p>)}
    </div>
  </main>;
}
