import { DRAMA_ID, type Bootstrap, type WatchState } from '../../shared/types';
import { advance, finishNode, initialWatch, selectEpisode, storyContext, tick } from '../../shared/story';
import { contentClient } from './yoroll';
import { playerMode } from '../platform/runtime';

const dramaId = new URLSearchParams(window.location.search).get('drama_id') || DRAMA_ID;
const progressKey = `yoroll-mini-watch:${dramaId}`;
let state: Awaited<ReturnType<ReturnType<typeof contentClient>['loadContent']>> | undefined;
let watch: WatchState | undefined;
let loading: Promise<void> | undefined;
function saveWatch() { localStorage.setItem(progressKey, JSON.stringify(watch)); }
async function ready() {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(dramaId)) throw new Error('Invalid drama ID.');
  if (state && watch) return;
  loading ??= (async () => {
    const result = await contentClient().loadContent(dramaId);
    let restored: WatchState | undefined;
    try {
      const value = JSON.parse(localStorage.getItem(progressKey) || 'null') as WatchState | null;
      if (value?.episodes?.[value.episodeId] && result.catalog.episodes.some(ep => ep.id === value.episodeId) &&
        Object.entries(value.episodes).every(([id, p]) => Array.isArray(p.path) && Array.isArray(p.choices) && p.watched &&
          result.catalog.episodes.find(ep => ep.id === id)?.graph.nodes.some(n => n.id === p.nodeId))) {
        restored = value; restored.playbackId = crypto.randomUUID(); delete restored.lastTick;
      }
    } catch { /* invalid or unavailable saved progress */ }
    state = result; watch = restored || initialWatch(result.catalog);
  })().catch(error => { loading = undefined; throw error; });
  await loading;
}
// Story actions are local state operations. Content comes directly from Yoroll/CDN.
export async function api<T>(path: string, body?: any, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted(); await ready(); signal?.throwIfAborted();
  const { catalog, cues } = state!;
  let result: unknown;
  if (path === '/bootstrap') {
    result = { catalog, watch: watch!, csrf: '', mode: playerMode(), chatProvider: 'yoroll', authenticated: true } satisfies Bootstrap;
  } else if (path === '/watch/select') { selectEpisode(watch!, catalog, body.episodeId, body.restart); saveWatch(); result = watch; }
  else if (path === '/watch/tick') { tick(watch!, body); saveWatch(); result = { ok: true }; }
  else if (path === '/watch/advance') { advance(watch!, catalog, body); saveWatch(); result = watch; }
  else if (path === '/watch/finish') { finishNode(watch!, catalog, body.playbackId); saveWatch(); result = watch; }
  else if (path.startsWith('/subtitles/')) { result = cues[path.slice('/subtitles/'.length)] || []; }
  else if (path.startsWith('/context/')) { result = storyContext(catalog, cues, watch!, path.slice('/context/'.length)); }
  else throw new Error(`Unsupported local story action: ${path}`);
  return structuredClone(result) as T;
}
export function keepProgress(body: unknown) { void api('/watch/tick', body).catch(() => {}); }
