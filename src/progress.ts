// Watch history, resume positions and player preferences, kept on-device like My List.
import { useSyncExternalStore } from "react";

const PROGRESS_KEY = "anilab.progress";
const THUMBS_KEY = "anilab.thumbs";
const PREFS_KEY = "anilab.playerPrefs";
const MAX_ENTRIES = 1000;
const MAX_THUMBS = 60; // ~10 KB each

export const WATCHED_RATIO = 0.9;

export interface EpisodeRef {
  id: string;
  number: string;
  name?: string;
}

export interface HistoryEntry {
  t: number; // seconds watched
  d: number; // duration
  at: number; // last update (ms)
  n?: string; // episode number
  name?: string; // episode name
}

interface SeriesInfo {
  title: string;
  poster: string;
}

interface LastWatched {
  ep: string;
  number: string;
  at: number;
  next?: EpisodeRef;
}

export interface ProgressData {
  episodes: Record<string, HistoryEntry>; // key: `${postId}:${episodeId}`
  last: Record<string, LastWatched>; // key: postId
  series: Record<string, SeriesInfo>;
  hidden: Record<string, number>; // postId -> removed from Continue Watching at (until watched again)
  deleted: Record<string, number>; // episode key -> removed from history at (sync tombstone)
  clearedAt: number; // Clear history time; older entries from other devices are dropped too
}

export interface PlayerPrefs {
  lang: string; // "sub" | "dub"
  autoNext: boolean;
  descending: boolean;
  quality: "auto" | number; // max height
  speed: number;
  volume: number;
  muted: boolean;
  autoSkip: boolean; // skip intro/recap/credits automatically (else show a Skip button)
}

function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable; keep the in-memory copy for this session.
  }
}

let progress: ProgressData = load(PROGRESS_KEY, { episodes: {}, last: {}, series: {}, hidden: {}, deleted: {}, clearedAt: 0 });
let thumbs: Record<string, string> = load(THUMBS_KEY, {});
let prefs: PlayerPrefs = load(PREFS_KEY, {
  lang: "sub",
  autoNext: true,
  descending: false,
  quality: "auto",
  speed: 1,
  volume: 1,
  muted: false,
  autoSkip: true,
});
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const keyOf = (postId: number | string, episodeId: string) => `${postId}:${episodeId}`;

export function setSeriesInfo(postId: number, info: SeriesInfo) {
  const current = progress.series[postId];
  if (current?.title === info.title && current?.poster === info.poster) return;
  progress = { ...progress, series: { ...progress.series, [postId]: info } };
  save(PROGRESS_KEY, progress);
  notify();
}

export function saveProgress(postId: number, episode: EpisodeRef, t: number, d: number, next?: EpisodeRef, thumb?: string) {
  const key = keyOf(postId, episode.id);
  const episodes = { ...progress.episodes, [key]: { t, d, at: Date.now(), n: episode.number, name: episode.name } };
  const keys = Object.keys(episodes);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => episodes[a].at - episodes[b].at);
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete episodes[k];
  }
  // Watching again brings a hidden series back to Continue Watching (last.at > hidden time).
  progress = {
    ...progress,
    episodes,
    last: { ...progress.last, [postId]: { ep: episode.id, number: episode.number, at: Date.now(), next } },
  };
  save(PROGRESS_KEY, progress);
  if (thumb) {
    thumbs = { ...thumbs, [key]: thumb };
    const tk = Object.keys(thumbs);
    if (tk.length > MAX_THUMBS) {
      tk.sort((a, b) => (episodes[a]?.at ?? 0) - (episodes[b]?.at ?? 0));
      for (const k of tk.slice(0, tk.length - MAX_THUMBS)) delete thumbs[k];
    }
    save(THUMBS_KEY, thumbs);
  }
  notify();
}

export function getProgress(postId: number, episodeId: string): HistoryEntry | undefined {
  return progress.episodes[keyOf(postId, episodeId)];
}

export function thumbFor(postId: number | string, episodeId: string): string | undefined {
  return thumbs[keyOf(postId, episodeId)];
}

export function hideFromContinue(postId: number) {
  progress = { ...progress, hidden: { ...progress.hidden, [postId]: Date.now() } };
  save(PROGRESS_KEY, progress);
  notify();
}

export function removeHistoryEntry(postId: number, episodeId: string) {
  const key = keyOf(postId, episodeId);
  const episodes = { ...progress.episodes };
  delete episodes[key];
  const last = { ...progress.last };
  if (last[postId]?.ep === episodeId) delete last[postId];
  progress = { ...progress, episodes, last, deleted: { ...progress.deleted, [key]: Date.now() } };
  thumbs = { ...thumbs };
  delete thumbs[key];
  save(PROGRESS_KEY, progress);
  save(THUMBS_KEY, thumbs);
  notify();
}

export function clearHistory() {
  progress = { episodes: {}, last: {}, series: progress.series, hidden: {}, deleted: {}, clearedAt: Date.now() };
  thumbs = {};
  save(PROGRESS_KEY, progress);
  save(THUMBS_KEY, thumbs);
  notify();
}

export function useProgress(): ProgressData {
  return useSyncExternalStore(subscribe, () => progress);
}

// ---- sync (thumbnails stay on-device) ----------------------------------------------------------

const TOMBSTONE_TTL = 120 * 86400000;

export const subscribeProgress = subscribe;

export function getProgressState(): ProgressData {
  return progress;
}

function newer<T extends { at: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.at > a.at ? b : a;
}

// Per-entry newest-wins merge; deletions and "clear history" win over anything older.
export function mergeProgress(a: ProgressData, b: ProgressData): ProgressData {
  const clearedAt = Math.max(a.clearedAt ?? 0, b.clearedAt ?? 0);
  const cutoff = Date.now() - TOMBSTONE_TTL;
  const deleted: Record<string, number> = {};
  for (const [k, t] of [...Object.entries(a.deleted ?? {}), ...Object.entries(b.deleted ?? {})]) {
    if (t > clearedAt && t > cutoff && t > (deleted[k] ?? 0)) deleted[k] = t;
  }
  const episodes: Record<string, HistoryEntry> = {};
  for (const k of new Set([...Object.keys(a.episodes), ...Object.keys(b.episodes)])) {
    const e = newer(a.episodes[k], b.episodes[k])!;
    if (e.at > clearedAt && e.at > (deleted[k] ?? 0)) episodes[k] = e;
  }
  const last: Record<string, LastWatched> = {};
  for (const p of new Set([...Object.keys(a.last), ...Object.keys(b.last)])) {
    const l = newer(a.last[p], b.last[p])!;
    if (episodes[keyOf(p, l.ep)]) last[p] = l;
  }
  const hidden: Record<string, number> = {};
  for (const [p, t] of [...Object.entries(a.hidden), ...Object.entries(b.hidden)]) {
    if (t > clearedAt && t > (hidden[p] ?? 0)) hidden[p] = t;
  }
  return { episodes, last, series: { ...b.series, ...a.series }, hidden, deleted, clearedAt };
}

export function replaceProgress(next: ProgressData) {
  progress = next;
  save(PROGRESS_KEY, progress);
  notify();
}

export interface ContinueItem {
  postId: number;
  title: string;
  poster?: string;
  episode: EpisodeRef; // what the card resumes
  upNext: boolean; // true when the last episode was finished and this is the next one
  t: number;
  d: number;
  at: number;
  thumb?: string;
}

// Crunchyroll-style rows: one card per series, newest first. A finished episode becomes "Up next"
// for the following one; a finished series drops out.
export function continueItems(data: ProgressData): ContinueItem[] {
  const items: ContinueItem[] = [];
  for (const [postId, last] of Object.entries(data.last)) {
    if ((data.hidden[postId] ?? 0) >= last.at) continue;
    const entry = data.episodes[keyOf(postId, last.ep)];
    const series = data.series[postId];
    if (!entry || !series) continue;
    const finished = entry.d > 0 && entry.t / entry.d >= WATCHED_RATIO;
    if (finished && !last.next) continue;
    items.push({
      postId: Number(postId),
      title: series.title,
      poster: series.poster,
      episode: finished && last.next ? last.next : { id: last.ep, number: last.number, name: entry.name },
      upNext: finished,
      t: finished ? 0 : entry.t,
      d: finished ? 0 : entry.d,
      at: last.at,
      thumb: finished ? undefined : thumbFor(postId, last.ep),
    });
  }
  return items.sort((a, b) => b.at - a.at);
}

export interface HistoryItem extends HistoryEntry {
  postId: number;
  episodeId: string;
  title: string;
  poster?: string;
  thumb?: string;
}

export function historyItems(data: ProgressData): HistoryItem[] {
  return Object.entries(data.episodes)
    .map(([key, e]) => {
      const sep = key.indexOf(":");
      const postId = key.slice(0, sep);
      const episodeId = key.slice(sep + 1);
      const series = data.series[postId];
      return { ...e, postId: Number(postId), episodeId, title: series?.title ?? "", poster: series?.poster, thumb: thumbFor(postId, episodeId) };
    })
    .filter((h) => h.title && h.n)
    .sort((a, b) => b.at - a.at);
}

export function usePlayerPrefs(): PlayerPrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}

export function getPlayerPrefs(): PlayerPrefs {
  return prefs;
}

export function setPlayerPrefs(patch: Partial<PlayerPrefs>) {
  prefs = { ...prefs, ...patch };
  save(PREFS_KEY, prefs);
  notify();
}
