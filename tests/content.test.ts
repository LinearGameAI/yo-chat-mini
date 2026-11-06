import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, loadDramaList, sourceUrl } from '../server/content.js';
import { DRAMA_ID } from '../shared/types.js';
import { nodeVideoUrl } from '../shared/drama.js';

const manifestUrl = 'https://drneqli4lopih.cloudfront.net/drama/v42/game.json?v=42';
const chapterUrl = 'https://drneqli4lopih.cloudfront.net/drama/v42/chapters/one/chapter.json';
const subtitleUrl = 'https://drneqli4lopih.cloudfront.net/drama/v42/chapters/one/Subtitles/one.en.srt';
test('the homepage requests only the paginated drama feed with the configured language', async t => {
  const data = { items: [{ game_id: 'paid-story', game_engine: 'drama', title: 'Real feed title', has_paid_content: true }], page: 2, page_size: 12, total: 13 };
  t.mock.method(globalThis, 'fetch', async (value: string, options: RequestInit) => {
    const url = new URL(value);
    assert.equal(url.pathname, new URL(sourceUrl).pathname.replace(/\/[^/]+$/, ''));
    assert.equal(url.searchParams.get('game_engine'), 'drama');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('page_size'), '12');
    assert.equal(new Headers(options.headers).get('Accept-Language'), process.env.YOROLL_CONTENT_LANGUAGE || 'en-US');
    return Response.json(data);
  });
  assert.deepEqual(await loadDramaList(2), data);
  data.items[0].game_engine = 'unity';
  await assert.rejects(loadDramaList(2), /invalid drama list/);
});

test('the homepage reports an unavailable feed instead of using a saved story', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(loadDramaList(), /drama list could not be loaded/);
});
function responses() {
  return new Map<string, unknown>([
    [sourceUrl, { game: { game_id: DRAMA_ID, game_engine: 'drama', game_json_url: manifestUrl,
      title: 'Online title', description: 'Online synopsis', portrait_cover_image: 'cover.jpg',
      tags: 'drama, interactive,drama', characters: [{ yochat_id: 'online-character', name: 'Online name', image_url: 'cast.jpg' }] } }],
    [manifestUrl, { videoBaseUrl: 'https://obsolete.example', chapters: [
      { id: 1, title: 'Online episode', dataPath: 'chapters/one/chapter.json' },
      { id: 2, dataPath: '' },
    ] }],
    [chapterUrl, { externalId: 'chapter-one', meta: { startNodeId: 'missing', cdnBase: 'https://obsolete.example', description: 'Online chapter description' },
      nodes: [{ id: 'node-one', video: 'one.mp4', coverImage: 'one.jpg', subtitles: { en: 'Subtitles/one.en.srt', zh: '', unknown: 'ignore.srt' } }] }],
    [subtitleUrl, '1\n00:00:01,000 --> 00:00:03,000\nOnline dialogue\n'],
  ]);
}

test('loads the selected drama and leaves restricted chapter graphs on the server', async t => {
  const data = responses(); const selectedId = 'another-drama';
  const selectedUrl = sourceUrl.replace(DRAMA_ID, selectedId);
  const detail = data.get(sourceUrl) as any;
  detail.game.game_id = selectedId;
  data.set(selectedUrl, detail);
  const manifest = data.get(manifestUrl) as any;
  manifest.chapters = [manifest.chapters[0], { id: '2', title: 'Paid episode', dataPath: 'restricted.json' }];
  manifest.chapterLock = { id: 'chapter:pass', fromChapter: 2, credits: 100 };
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requested.push(url);
    assert.ok(data.has(url), `Unexpected request, possibly a restricted chapter: ${url}`);
    return typeof data.get(url) === 'string' ? new Response(String(data.get(url))) : Response.json(data.get(url));
  });
  const { catalog } = await loadContent(selectedId);
  assert.equal(catalog.id, selectedId);
  assert.equal(catalog.totalEpisodes, 2);
  assert.equal(catalog.episodes.length, 1);
  assert.deepEqual(catalog.lockedEpisodes, [{ id: '2', title: 'Paid episode' }]);
  assert.deepEqual(requested, [selectedUrl, manifestUrl, chapterUrl, subtitleUrl]);
  manifest.chapterLock.fromChapter = 1;
  await assert.rejects(loadContent(selectedId), /暂无免费章节/);
});

test('a drama without linked chat characters still loads as a playable catalog', async t => {
  const data = responses(); (data.get(sourceUrl) as any).game.characters = null;
  t.mock.method(globalThis, 'fetch', async (url: string) => typeof data.get(url) === 'string' ? new Response(String(data.get(url))) : Response.json(data.get(url)));
  assert.deepEqual((await loadContent()).catalog.characters, []);
});

test('linked characters can use the official chat service watermark image URL', async t => {
  const data = responses();
  const image = 'https://chat-api.lineargame.ai/yochat/characters/covers/watermarks/yoroll-v4/example/image';
  (data.get(sourceUrl) as any).game.characters[0].image_url = image;
  t.mock.method(globalThis, 'fetch', async (url: string) => typeof data.get(url) === 'string' ? new Response(String(data.get(url))) : Response.json(data.get(url)));
  assert.equal((await loadContent()).catalog.characters[0].image, image);
});

test('loads Yoroll detail, manifest, chapter and subtitles using the published version directories', async t => {
  const data = responses(); const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    requested.push(url);
    assert.equal(new Headers(options.headers).get('Accept-Language'), process.env.YOROLL_CONTENT_LANGUAGE || 'en-US');
    assert.equal(options.redirect, 'error');
    assert.ok(data.has(url), `Unexpected content URL: ${url}`);
    return typeof data.get(url) === 'string' ? new Response(String(data.get(url))) : Response.json(data.get(url));
  });
  const { catalog, cues } = await loadContent();
  assert.deepEqual(requested, [sourceUrl, manifestUrl, chapterUrl, subtitleUrl]);
  assert.equal(catalog.source, 'live');
  assert.equal(catalog.title, 'Online title');
  assert.equal(catalog.cover, 'https://drneqli4lopih.cloudfront.net/drama/v42/cover.jpg');
  assert.equal(catalog.characters[0].id, 'online-character');
  assert.deepEqual(catalog.tags, ['drama', 'interactive']);
  assert.equal(catalog.episodes.length, 1);
  const episode = catalog.episodes[0];
  assert.equal(episode.id, '1');
  assert.equal(episode.cover, '');
  assert.equal(episode.graph.startNodeId, 'node-one');
  assert.equal(episode.graph.description, 'Online chapter description');
  assert.equal(nodeVideoUrl(episode.graph.cdnBase, episode.graph.nodes[0]), chapterUrl.replace('chapter.json', 'one.mp4'));
  assert.equal(cues['1/node-one'][0].text, 'Online dialogue');
});

test('an online failure rejects even with the old snapshot configuration, and a new attempt fetches again', async t => {
  const previous = process.env.CONTENT_SOURCE;
  process.env.CONTENT_SOURCE = 'snapshot';
  t.after(() => { if (previous === undefined) delete process.env.CONTENT_SOURCE; else process.env.CONTENT_SOURCE = previous; });
  const data = responses(); let unavailable = true; let detailCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === sourceUrl) { detailCalls++; if (unavailable) return new Response('', { status: 503 }); }
    return typeof data.get(url) === 'string' ? new Response(String(data.get(url))) : Response.json(data.get(url));
  });
  await assert.rejects(loadContent(), /Yoroll drama detail could not be loaded/);
  unavailable = false;
  assert.equal((await loadContent()).catalog.source, 'live');
  assert.equal(detailCalls, 2);
});

test('retries a temporary CDN failure and never substitutes saved content for invalid chapter JSON', async t => {
  const data = responses(); let chapterCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === chapterUrl && ++chapterCalls === 1) return new Response('', { status: 502 });
    return typeof data.get(url) === 'string' ? new Response(String(data.get(url))) : Response.json(data.get(url));
  });
  assert.equal((await loadContent()).catalog.episodes.length, 1);
  assert.equal(chapterCalls, 2);
  data.set(chapterUrl, { nodes: [] });
  await assert.rejects(loadContent(), /Invalid chapter graph/);
});

test('stops after three failed CDN attempts and reports the failing stage', async t => {
  let manifestCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === sourceUrl) return Response.json(responses().get(sourceUrl));
    assert.equal(url, manifestUrl); manifestCalls++;
    return new Response('not JSON', { status: 200 });
  });
  await assert.rejects(loadContent(), /Yoroll chapter list could not be loaded/);
  assert.equal(manifestCalls, 3);
});

test('rejects a different engine and an untrusted manifest before fetching its resources', async t => {
  const detail: any = responses().get(sourceUrl);
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, sourceUrl);
    return Response.json(detail);
  });
  detail.game.game_engine = 'unity';
  await assert.rejects(loadContent(), /Unexpected drama identity/);
  detail.game.game_engine = 'drama'; detail.game.game_json_url = 'https://untrusted.example/game.json';
  await assert.rejects(loadContent(), /Unrecognized content host/);
});
