import { randomUUID } from 'node:crypto';
import type { Catalog, CueMap, Episode, EpisodeProgress, Interval, StoryContext, WatchState } from '../shared/types.js';

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function episodeOf(catalog: Catalog, id: string): Episode {
  const ep = catalog.episodes.find(e => e.id === id || e.externalId === id);
  if (!ep) throw new AppError(400, 'This episode is not part of this drama.');
  return ep;
}
export function initialProgress(ep: Episode): EpisodeProgress {
  return { nodeId: ep.graph.startNodeId, position: 0, path: [ep.graph.startNodeId], choices: [], watched: {}, ended: false };
}
export function initialWatch(catalog: Catalog): WatchState {
  const ep = catalog.episodes[0];
  return { episodeId: ep.id, playbackId: randomUUID(), episodes: { [ep.id]: initialProgress(ep) } };
}
export function selectEpisode(w: WatchState, catalog: Catalog, episodeId: string, restart = false) {
  const ep = episodeOf(catalog, episodeId);
  if (restart || !w.episodes[ep.id] || !ep.graph.nodes.some(n => n.id === w.episodes[ep.id].nodeId)) w.episodes[ep.id] = initialProgress(ep);
  w.episodeId = ep.id; w.playbackId = randomUUID(); delete w.lastTick;
  return w;
}
export function mergeInterval(ranges: Interval[], range: Interval): Interval[] {
  const sorted = [...ranges, range].filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  return sorted.reduce<Interval[]>((out, item) => {
    const last = out.at(-1);
    if (last && item[0] <= last[1] + 0.15) last[1] = Math.max(last[1], item[1]); else out.push([...item]);
    return out;
  }, []);
}
export function tick(w: WatchState, data: { playbackId: string; nodeId: string; position: number; playing: boolean }, now = Date.now()) {
  const progress = w.episodes[w.episodeId];
  if (w.playbackId !== data.playbackId || progress.nodeId !== data.nodeId) throw new AppError(409, 'Playback changed. Reload the player.');
  const last = w.lastTick;
  if (last?.playing) {
    const elapsed = Math.min(8, Math.max(0, (now - last.time) / 1000));
    const delta = data.position - last.position;
    // A seek saves the position but never grants unseen subtitles. No frontend story text is accepted.
    if (delta > 0 && delta <= elapsed * 1.2 + 0.3) {
      progress.watched[progress.nodeId] = mergeInterval(progress.watched[progress.nodeId] ?? [], [last.position, data.position]);
    }
  }
  progress.position = data.position;
  w.lastTick = { time: now, position: data.position, playing: data.playing };
}
export function advance(w: WatchState, catalog: Catalog, data: { playbackId: string; choiceKey?: string; qteOutcome?: 'success' | 'fail' | 'timeout' }) {
  if (data.playbackId !== w.playbackId) throw new AppError(409, 'Playback changed.');
  const ep = episodeOf(catalog, w.episodeId); const p = w.episodes[ep.id];
  const node = ep.graph.nodes.find(n => n.id === p.nodeId)!;
  let next: string | undefined;
  if (node.endType) { p.ended = true; p.pendingInteraction = false; delete w.lastTick; return; }
  if (node.choices?.length) {
    const choice = node.choices.find(c => c.key === data.choiceKey);
    if (!choice) throw new AppError(400, 'Choose one of the published story options.');
    next = choice.next;
    p.choices.push({ fromNodeId: node.id, choiceKey: choice.key, next });
  } else if (node.qte) {
    if (!data.qteOutcome) throw new AppError(400, 'An interaction result is required.');
    next = node.qte[`${data.qteOutcome}Next`];
  } else next = node.next;
  if (!next) { p.ended = true; p.pendingInteraction = false; delete w.lastTick; return; }
  if (!ep.graph.nodes.some(n => n.id === next)) throw new AppError(422, 'The published branch has no playable destination.');
  p.nodeId = next; p.position = 0; p.ended = false; p.pendingInteraction = false; p.path.push(next);
  w.playbackId = randomUUID(); delete w.lastTick;
}
export function finishNode(w: WatchState, catalog: Catalog, playbackId: string) {
  if (playbackId !== w.playbackId) throw new AppError(409, 'Playback changed.');
  const ep = episodeOf(catalog, w.episodeId); const p = w.episodes[ep.id];
  const node = ep.graph.nodes.find(n => n.id === p.nodeId)!;
  if (!node.endType && (node.choices?.length || node.qte)) { p.pendingInteraction = true; delete w.lastTick; }
  else advance(w, catalog, { playbackId });
}
export function storyContext(catalog: Catalog, cues: CueMap, w: WatchState, characterId: string): StoryContext {
  if (!catalog.characters.some(c => c.id === characterId)) throw new AppError(400, 'This character is not associated with this drama.');
  const active = episodeOf(catalog, w.episodeId); const progress = w.episodes[active.id];
  const facts: StoryContext['facts'] = []; const choices: StoryContext['choices'] = []; const seenScenes: StoryContext['seenScenes'] = [];
  const activeIndex = catalog.episodes.indexOf(active);
  for (const ep of catalog.episodes.slice(0, activeIndex + 1)) {
    const p = w.episodes[ep.id]; if (!p) continue;
    for (const nodeId of [...new Set(p.path)]) {
      const ranges = p.watched[nodeId] ?? [];
      const cap = ep.id === active.id && nodeId === p.nodeId ? p.position : Infinity;
      seenScenes.push({ episode_id: ep.externalId, node_id: nodeId, position: Number.isFinite(cap) ? cap : Math.max(0, ...ranges.map(r => r[1])) });
      (cues[`${ep.id}/${nodeId}`] ?? []).forEach((cue, i) => {
        // Include only fully observed subtitle cues, never node titles, synopsis or character opening/persona.
        if (cue.endMs / 1000 <= cap && ranges.some(([a, b]) => a <= cue.startMs / 1000 + 0.15 && b >= cue.endMs / 1000)) {
          facts.push({ id: `${ep.id}/${nodeId}/${i}`, text: cue.text });
        }
      });
    }
    for (const choice of p.choices) {
      const source = ep.graph.nodes.find(n => n.id === choice.fromNodeId);
      const verified = source?.choices?.find(c => c.key === choice.choiceKey && c.next === choice.next);
      if (verified) choices.push({ fromNodeId: source!.id, choiceKey: verified.key, label: verified.label });
    }
  }
  return { drama_id: catalog.id, episode_id: active.externalId, node_id: progress.nodeId, scene_id: progress.nodeId,
    character_id: characterId, position: progress.position, facts, choices, seenScenes,
    evidenceIds: [...facts.map(f => f.id), ...choices.map(c => `choice/${c.fromNodeId}/${c.choiceKey}`)] };
}
export function visibleMessages<T extends { evidenceIds: string[]; scope?: { episode_id: string; node_id: string; position: number } }>(messages: T[], context: StoryContext): T[] {
  const allowed = new Set(context.evidenceIds);
  return messages.filter(m => m.evidenceIds.every(id => allowed.has(id)) && (m.scope
    ? context.seenScenes.some(s => s.episode_id === m.scope!.episode_id && s.node_id === m.scope!.node_id && s.position + 0.1 >= m.scope!.position)
    : m.evidenceIds.length > 0));
}
