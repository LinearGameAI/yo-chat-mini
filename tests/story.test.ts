import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCatalog } from '../server/content.js';
import { advance, finishNode, initialWatch, selectEpisode, storyContext, tick, visibleMessages } from '../server/story.js';
import { playbackLifecycle } from '../shared/playbackLifecycle.js';
import { parseFrame, readSse } from '../shared/sse.js';
import { mockReply } from '../server/chat.js';

const { catalog, cues } = normalizeCatalog(JSON.parse(fs.readFileSync('fixtures/spooky-doll.json', 'utf8')), 'snapshot');
const character = catalog.characters[0].id;
test('the captured public data resolves the drama (not its same-named Unity game)', () => {
  assert.equal(catalog.episodes.length, 10); assert.equal(catalog.characters.length, 1);
  assert.equal(character, 'yt_daniel_renault_married_doll');
  assert.equal(catalog.episodes.flatMap(e => e.graph.nodes).length, 49);
});
test('future node names, synopsis and unseen subtitle text are never story facts', () => {
  const watch = initialWatch(catalog); const ctx = storyContext(catalog, cues, watch, character);
  assert.equal(ctx.facts.length, 0); assert.ok(!JSON.stringify(ctx).includes(catalog.description));
  assert.ok(!JSON.stringify(ctx).includes('Unimagined'));
  assert.throws(() => storyContext(catalog, cues, watch, 'not-a-linked-character'));
});
test('seeking saves position but cannot unlock skipped subtitles', () => {
  const watch = initialWatch(catalog); const nodeId = watch.episodes['1'].nodeId;
  tick(watch, { playbackId: watch.playbackId, nodeId, position: 0, playing: true }, 1000);
  tick(watch, { playbackId: watch.playbackId, nodeId, position: 80, playing: false }, 2000);
  assert.equal(watch.episodes['1'].position, 80); assert.equal(storyContext(catalog, cues, watch, character).facts.length, 0);
});
test('real watch intervals reveal only complete observed cues; rewind removes later context and messages', () => {
  const watch = initialWatch(catalog); const nodeId = watch.episodes['1'].nodeId;
  for (let second = 0; second <= 10; second++) tick(watch, { playbackId: watch.playbackId, nodeId, position: second, playing: true }, 1000 + second * 1000);
  const ctx = storyContext(catalog, cues, watch, character);
  assert.equal(ctx.facts.length, 1); assert.match(ctx.facts[0].text, /丹尼尔/);
  assert.ok(!JSON.stringify(ctx.facts).includes('汽车'));
  const history = [{ evidenceIds: ctx.evidenceIds, text: 'We saw that moment' }];
  assert.equal(visibleMessages(history, ctx).length, 1);
  tick(watch, { playbackId: watch.playbackId, nodeId, position: 1, playing: false }, 12000);
  assert.equal(visibleMessages(history, storyContext(catalog, cues, watch, character)).length, 0);
});
test('only published choices advance; chapter switching restores branch and time; stale ticks cannot overwrite it', () => {
  const watch = initialWatch(catalog); const oldId = watch.playbackId; const start = watch.episodes['1'].nodeId;
  assert.throws(() => advance(watch, catalog, { playbackId: oldId, choiceKey: 'made-up' }));
  const choice = catalog.episodes[0].graph.nodes.find(n => n.id === start)!.choices![0];
  advance(watch, catalog, { playbackId: oldId, choiceKey: choice.key });
  assert.equal(watch.episodes['1'].nodeId, choice.next);
  tick(watch, { playbackId: watch.playbackId, nodeId: choice.next, position: 4, playing: false });
  selectEpisode(watch, catalog, '2'); selectEpisode(watch, catalog, '1');
  assert.equal(watch.episodes['1'].position, 4); assert.equal(watch.episodes['1'].choices[0].choiceKey, choice.key);
  assert.throws(() => tick(watch, { playbackId: oldId, nodeId: start, position: 0, playing: false }));
  assert.throws(() => selectEpisode(watch, catalog, '11'));
});
test('QTE success/timeout follow the real published graph', () => {
  for (const outcome of ['success', 'timeout'] as const) {
    const watch = initialWatch(catalog); selectEpisode(watch, catalog, '2');
    const node = catalog.episodes[1].graph.nodes.find(n => n.id === watch.episodes['2'].nodeId)!;
    advance(watch, catalog, { playbackId: watch.playbackId, qteOutcome: outcome });
    assert.equal(watch.episodes['2'].nodeId, node.qte![`${outcome}Next`]);
  }
});
test('pending choices persist across navigation and clear only on a published transition', () => {
  const watch = initialWatch(catalog); finishNode(watch, catalog, watch.playbackId);
  const restored = JSON.parse(JSON.stringify(watch));
  assert.equal(restored.episodes['1'].pendingInteraction, true);
  const node = catalog.episodes[0].graph.nodes.find(n => n.id === restored.episodes['1'].nodeId)!;
  advance(restored, catalog, { playbackId: restored.playbackId, choiceKey: node.choices![0].key });
  assert.equal(restored.episodes['1'].pendingInteraction, false);
});
test('duplicate hide/show events preserve playing intent, but never resume an already paused video', () => {
  for (const initiallyPlaying of [true, false]) {
    let playing = initiallyPlaying; let saves = 0; let plays = 0;
    const lifecycle = playbackLifecycle({ isPlaying: () => playing, pause: () => { playing = false; }, save: () => { saves++; }, play: () => { playing = true; plays++; } });
    lifecycle.hide(); lifecycle.hide(); lifecycle.show(); lifecycle.show();
    assert.equal(playing, initiallyPlaying); assert.equal(saves, 1); assert.equal(plays, initiallyPlaying ? 1 : 0);
  }
});
test('mock is context limited and will not invent the ending', () => {
  const ctx = storyContext(catalog, cues, initialWatch(catalog), character);
  assert.match(mockReply(ctx, 'Tell me the ending'), /won’t reveal/);
  assert.match(mockReply(ctx, 'What happened?'), /Watch a little/);
});
test('SSE accepts multiline data, CRLF, comments and split UTF-8 packets', async () => {
  assert.deepEqual(parseFrame(':keepalive\r\nevent: response.delta\r\ndata: one\r\ndata: two'), { event: 'response.delta', data: 'one\ntwo' });
  const bytes = new TextEncoder().encode('event: response.delta\r\ndata: 你好\r\n\r\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const result = []; for await (const event of readSse(body)) result.push(event);
  assert.deepEqual(result, [{ event: 'response.delta', data: '你好' }]);
});
