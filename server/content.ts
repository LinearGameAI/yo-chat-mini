import fs from 'node:fs/promises';
import { normalizeNode } from '../shared/drama.js';
import { parseSrt } from '../shared/subtitles.js';
import { DRAMA_ID, type Catalog, type Snapshot, type CueMap } from '../shared/types.js';

export const sourceUrl = `https://api.lineargame.ai/api/v1/feed/games/${DRAMA_ID}`;
const allowedHosts = new Set(['api.lineargame.ai', 'drneqli4lopih.cloudfront.net', 'image-dit.lineargame.ai', 'd37ji9cq1jykee.cloudfront.net']);
export function safeAsset(value: string, base?: string) {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('Unrecognized content host');
  return url.href;
}
async function fetchText(url: string) {
  const response = await fetch(safeAsset(url), { signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!response.ok) throw new Error(`Content service returned ${response.status}`);
  return response.text();
}
export async function fetchSnapshot(): Promise<Snapshot> {
  const detail = JSON.parse(await fetchText(sourceUrl));
  if (detail.game?.game_id !== DRAMA_ID || detail.game?.game_engine !== 'drama') throw new Error('Unexpected drama identity');
  const manifestUrl = safeAsset(detail.game.game_json_url);
  const manifest = JSON.parse(await fetchText(manifestUrl));
  if (manifest.chapterLock) throw new Error('This MVP cannot unlock paid content');
  const entries = await Promise.all(manifest.chapters.map(async (chapter: any) => {
    const url = safeAsset(chapter.dataPath, manifestUrl);
    return [chapter.id, JSON.parse(await fetchText(url))] as const;
  }));
  const chapters = Object.fromEntries(entries);
  const subtitles: Record<string, string> = {};
  const urls = [...new Set(entries.flatMap(([id, graph]) => {
    const chapter = manifest.chapters.find((c: any) => c.id === id);
    return graph.nodes.flatMap((n: any) => Object.values(n.subtitles ?? {}).map(p => safeAsset(String(p), safeAsset(chapter.dataPath, manifestUrl))));
  }))] as string[];
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(urls.slice(i, i + 8).map(async url => { subtitles[url] = await fetchText(url); }));
  }
  return { fetchedAt: new Date().toISOString(), sourceUrl, detail, manifest, chapters, subtitles };
}
export function normalizeCatalog(snapshot: Snapshot, source: Catalog['source']): { catalog: Catalog; cues: CueMap } {
  const g = snapshot.detail.game;
  if (g.game_id !== DRAMA_ID || g.game_engine !== 'drama' || snapshot.manifest.chapterLock) throw new Error('Unsupported drama');
  const manifestUrl = safeAsset(g.game_json_url);
  const episodes = snapshot.manifest.chapters.map((c: any) => {
    const raw = snapshot.chapters[c.id];
    const detailUrl = safeAsset(c.dataPath, manifestUrl);
    const base = new URL('.', detailUrl).href.replace(/\/$/, '');
    const nodes = raw.nodes.map((n: any) => normalizeNode(n, base)).filter(Boolean);
    if (!nodes.length || !nodes.some((n: any) => n.id === raw.meta.startNodeId)) throw new Error('Invalid chapter graph');
    return { id: c.id, externalId: c.externalId, title: c.title, cover: safeAsset(c.coverImage, manifestUrl),
      graph: { externalId: raw.externalId, cdnBase: base, startNodeId: raw.meta.startNodeId, description: '', nodes } };
  });
  const catalog: Catalog = { id: DRAMA_ID, title: g.title, description: g.description, cover: safeAsset(g.portrait_cover_image, manifestUrl),
    tags: String(g.tags).split(',').filter(Boolean), characters: g.characters.map((c: any) => ({ id: c.yochat_id, name: c.name, image: safeAsset(c.image_url) })),
    episodes, source, fetchedAt: snapshot.fetchedAt };
  const cues: CueMap = {};
  for (const ep of episodes) for (const node of ep.graph.nodes) {
    const url = node.subtitles?.en ?? node.subtitles?.zh;
    cues[`${ep.id}/${node.id}`] = url ? parseSrt(snapshot.subtitles[url] ?? '') : [];
  }
  return { catalog, cues };
}
export async function loadContent() {
  if (process.env.CONTENT_SOURCE !== 'snapshot') {
    try { return normalizeCatalog(await fetchSnapshot(), 'live'); }
    catch (error) { console.warn('Live content unavailable; loading the labeled public API snapshot.'); }
  }
  const snapshot: Snapshot = JSON.parse(await fs.readFile('fixtures/spooky-doll.json', 'utf8'));
  return normalizeCatalog(snapshot, 'snapshot');
}
