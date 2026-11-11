import { normalizeNode } from './drama.js';
import { throwIfAborted, timedSignal } from './abort.js';
import { parseSrt } from './subtitles.js';
import { DRAMA_ID, type Catalog, type Snapshot, type CueMap, type DramaList } from './types.js';

export class ContentAccessError extends Error {}

export interface ContentOptions { baseUrl: string; language?: string; signal?: AbortSignal }
export function createContentClient(options: ContentOptions) {
  const sourceUrl = `${options.baseUrl.replace(/\/+$/, '')}/feed/games/${DRAMA_ID}`;
  async function loadDramaList(page = 1): Promise<DramaList> {
    const url = new URL(sourceUrl.slice(0, sourceUrl.lastIndexOf('/')));
    url.search = new URLSearchParams({ game_engine: 'drama', page: String(page), page_size: '12' }).toString();
    const data = await fetchContent<DramaList>(url.href, 'drama list', true);
    if (!Array.isArray(data.items) || !Number.isInteger(data.total) || data.total < 0 ||
        data.page !== page || data.page_size !== 12 || data.items.some(item =>
          item.game_engine !== 'drama' || typeof item.game_id !== 'string' || typeof item.title !== 'string')) {
      throw new Error('Yoroll returned an invalid drama list.');
    }
    return data;
  }
  const allowedHosts = new Set(['api.lineargame.ai', 'test-api.lineargame.ai', 'chat-api.lineargame.ai', 'test-chat-api.lineargame.ai', 'drneqli4lopih.cloudfront.net', 'image-dit.lineargame.ai', 'test-image-dit.lineargame.ai', 'd3tsqxxffq1uhg.cloudfront.net', 'd37ji9cq1jykee.cloudfront.net']);
  function safeAsset(value: string, base?: string) {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('Unrecognized content host');
    return url.href;
  }
  async function fetchContent<T>(url: string, stage: string, json: boolean, retries = 0): Promise<T> {
    const target = safeAsset(url);
    const logFeed = stage === 'drama list';
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(options.signal);
      const request = timedSignal(options.signal, 12000);
      try {
        if (logFeed) console.info('[mini-startup] Feed request', { url: target, pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin, language: options.language || 'en-US', attempt });
        const response = await fetch(target, { signal: request.signal, redirect: 'error',
          headers: { 'Accept-Language': options.language || 'en-US' } });
        if (logFeed) console.info('[mini-startup] Feed HTTP response', { status: response.status, ok: response.ok, contentType: response.headers.get('content-type'), redirected: response.redirected });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await (json ? response.json() : response.text()) as T;
      } catch (cause) {
        throwIfAborted(options.signal);
        if (attempt >= retries) throw new Error(`Yoroll ${stage} could not be loaded. Please try again.`, { cause });
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      } finally {
        request.dispose();
      }
    }
  }
  async function fetchSnapshot(dramaId = DRAMA_ID): Promise<Snapshot> {
    const detailUrl = `${sourceUrl.slice(0, sourceUrl.lastIndexOf('/'))}/${encodeURIComponent(dramaId)}`;
    const detail = await fetchContent<Snapshot['detail']>(detailUrl, 'drama detail', true);
    if (detail.game?.game_id !== dramaId || detail.game?.game_engine !== 'drama') throw new Error('Unexpected drama identity');
    const manifestUrl = safeAsset(detail.game.game_json_url);
    const manifest = await fetchContent<Snapshot['manifest']>(manifestUrl, 'chapter list', true, 2);
    manifest.chapters = (Array.isArray(manifest.chapters) ? manifest.chapters : [])
      .map((chapter: any, index: number) => ({ ...chapter, id: String(chapter.id ?? index + 1) }))
      .filter((chapter: any) => typeof chapter.dataPath === 'string' && chapter.dataPath.length > 0);
    if (!manifest.chapters.length) throw new Error('Yoroll chapter list is empty.');
    const freeChapters = playableChapters(manifest);
    if (!freeChapters.length) throw new ContentAccessError('这部短剧需要会员或解锁后观看，当前暂无免费章节。');
    const entries = await Promise.all(freeChapters.map(async (chapter: any) => {
      const url = safeAsset(chapter.dataPath, manifestUrl);
      return [chapter.id, await fetchContent<Record<string, any>>(url, `chapter ${chapter.id}`, true, 2)] as const;
    }));
    const chapters = Object.fromEntries(entries);
    const subtitles: Record<string, string> = {};
    const urls = [...new Set(entries.flatMap(([id, graph]) => {
      const chapter = manifest.chapters.find((c: any) => c.id === id);
      return (Array.isArray(graph.nodes) ? graph.nodes : []).flatMap((n: any) => ['en', 'zh'].flatMap(lang => {
        const value = n.subtitles?.[lang];
        return typeof value === 'string' && value.trim() ? [safeAsset(value.trim(), safeAsset(chapter.dataPath, manifestUrl))] : [];
      }));
    }))] as string[];
    for (let i = 0; i < urls.length; i += 8) {
      await Promise.all(urls.slice(i, i + 8).map(async url => { subtitles[url] = await fetchContent<string>(url, 'subtitles', false, 2); }));
    }
    return { fetchedAt: new Date().toISOString(), sourceUrl: detailUrl, detail, manifest, chapters, subtitles };
  }
  function playableChapters(manifest: Snapshot['manifest']): any[] {
    if (!manifest.chapterLock) return manifest.chapters;
    const lockIndex = manifest.chapters.findIndex((chapter: any) => String(chapter.id) === String(manifest.chapterLock.fromChapter));
    // This app has no entitlement exchange. Never load restricted chapter graphs.
    if (lockIndex < 0) throw new Error('Invalid chapter lock configuration');
    return manifest.chapters.slice(0, lockIndex);
  }
  function normalizeCatalog(snapshot: Snapshot, source: Catalog['source']): { catalog: Catalog; cues: CueMap } {
    const g = snapshot.detail.game;
    if (!g.game_id || g.game_engine !== 'drama') throw new Error('Unsupported drama');
    const manifestUrl = safeAsset(g.game_json_url);
    const episodes = playableChapters(snapshot.manifest).map((c: any) => {
      const raw = snapshot.chapters[c.id];
      const detailUrl = safeAsset(c.dataPath, manifestUrl);
      const base = new URL('.', detailUrl).href.replace(/\/$/, '');
      const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map((n: any) => normalizeNode(n, base)).filter(Boolean);
      if (!nodes.length) throw new Error('Invalid chapter graph');
      const startNodeId = nodes.some((n: any) => n.id === raw.meta?.startNodeId) ? raw.meta.startNodeId : nodes[0].id;
      return { id: String(c.id), externalId: c.externalId ?? '', title: c.title ?? '', cover: c.coverImage ? safeAsset(c.coverImage, manifestUrl) : '',
        graph: { externalId: raw.externalId ?? '', cdnBase: base, startNodeId, description: raw.meta?.description ?? '', nodes } };
    });
    const catalog: Catalog = { id: g.game_id, title: g.title, description: g.description ?? '', cover: safeAsset(g.portrait_cover_image || g.cover_image, manifestUrl),
      tags: [...new Set(String(g.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean))], characters: (Array.isArray(g.characters) ? g.characters : []).filter((c: any) => typeof c.yochat_id === 'string' && c.yochat_id && typeof c.name === 'string').map((c: any) => ({ id: c.yochat_id, name: c.name, image: c.image_url ? safeAsset(c.image_url, manifestUrl) : '' })),
      totalEpisodes: snapshot.manifest.chapters.length, finished: snapshot.manifest.finished !== false,
      lockedEpisodes: snapshot.manifest.chapters.slice(episodes.length).map((c: any) => ({ id: String(c.id), title: c.title ?? '' })),
      episodes, source, fetchedAt: snapshot.fetchedAt };
    const cues: CueMap = {};
    for (const ep of episodes) for (const node of ep.graph.nodes) {
      const url = node.subtitles?.en ?? node.subtitles?.zh;
      cues[`${ep.id}/${node.id}`] = url ? parseSrt(snapshot.subtitles[url] ?? '') : [];
    }
    return { catalog, cues };
  }
  async function loadContent(dramaId = DRAMA_ID) {
    // Match YorollApp's detail -> game.json -> chapter JSON flow. Never serve a fixture on failure.
    return normalizeCatalog(await fetchSnapshot(dramaId), 'live');
  }

  return { sourceUrl, loadDramaList, safeAsset, fetchSnapshot, normalizeCatalog, loadContent };
}
