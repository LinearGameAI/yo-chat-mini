import type { ChapterGraph } from './drama.js';
import type { SubtitleCue } from './subtitles.js';

export const DRAMA_ID = '900a3d4e-6589-4c66-8287-d9bd06937c11';
export interface DramaListItem {
  game_id: string; title: string; cover_image: string; portrait_cover_image?: string;
  game_engine: 'drama'; display_count: number; tags: string;
  has_paid_content?: boolean; has_membership_content?: boolean;
}
export interface DramaList { items: DramaListItem[]; page: number; page_size: number; total: number }
export interface Character { id: string; name: string; image: string }
export interface Episode { id: string; externalId: string; title: string; cover: string; graph: ChapterGraph }
export interface Catalog {
  id: string; title: string; description: string; cover: string; tags: string[];
  characters: Character[]; episodes: Episode[]; source: 'live' | 'snapshot'; fetchedAt: string;
  totalEpisodes?: number; finished?: boolean;
  lockedEpisodes?: { id: string; title: string }[];
}
export interface Snapshot {
  fetchedAt: string; sourceUrl: string; detail: Record<string, any>; manifest: Record<string, any>;
  chapters: Record<string, any>; subtitles: Record<string, string>;
}
export type Interval = [number, number];
export interface EpisodeProgress {
  nodeId: string; position: number; path: string[];
  choices: { fromNodeId: string; choiceKey: string; next: string }[];
  watched: Record<string, Interval[]>;
  ended: boolean;
  pendingInteraction?: boolean;
}
export interface WatchState {
  episodeId: string; playbackId: string; episodes: Record<string, EpisodeProgress>;
  lastTick?: { time: number; position: number; playing: boolean };
}
export interface StoryContext {
  drama_id: string; episode_id: string; scene_id: string; node_id: string; character_id: string;
  position: number; facts: { id: string; text: string }[];
  choices: { fromNodeId: string; choiceKey: string; label: string }[];
  evidenceIds: string[];
  seenScenes: { episode_id: string; node_id: string; position: number }[];
}
export interface Message { id: string; role: 'user' | 'assistant'; text: string; evidenceIds: string[]; createdAt: string; scope?: { episode_id: string; node_id: string; position: number } }
export interface Conversation {
  id: string; characterId: string; messages: Message[];
  yoroll?: { id: string; baseUrl: string; userId: string; historyIds: string[] };
}
export interface Session {
  id: string; csrf: string; identity: 'local' | 'tiktok'; userId: string; watch: WatchState; conversations: Record<string, Conversation>;
  dramaId?: string;
  // Server-only. Verified unified-platform session; never populated from client identity input.
  yorollAuth?: { accessToken: string; userId: string; refreshToken?: string; expiresAt?: string };
}
export interface Bootstrap {
  catalog: Catalog; watch: WatchState; csrf: string;
  mode: 'local' | 'tiktok'; chatProvider: 'mock' | 'openai-compatible' | 'yoroll'; authenticated: boolean;
}
export type CueMap = Record<string, SubtitleCue[]>;
