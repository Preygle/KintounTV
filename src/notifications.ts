// New-episode notifications for airing shows you follow (My List and Continue Watching). Each
// show's latest episode is checked on start and every 30 minutes; the first check of a show only
// records where it is, so only episodes released after that are announced.
import { useSyncExternalStore } from "react";
import { watchApi } from "./api";
import { loadMeta } from "./catalog";
import { getMyListState } from "./myList";
import { continueItems, getProgressState } from "./progress";

export interface Notice {
  postId: number;
  title: string;
  poster: string;
  episode: string; // latest episode number
  at: number;
  read: boolean;
}

interface State {
  latest: Record<string, number>; // postId -> latest episode number seen
  items: Notice[];
}

const KEY = "kintoun.notifications";
const CHECK_EVERY = 30 * 60000;
const MAX_SHOWS = 20;
const MAX_ITEMS = 30;

let state: State = (() => {
  try {
    return { latest: {}, items: [], ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<State>) };
  } catch {
    return { latest: {}, items: [] };
  }
})();
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function useNotifications(): Notice[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state.items,
  );
}

export function markAllRead() {
  if (state.items.some((n) => !n.read)) commit({ ...state, items: state.items.map((n) => ({ ...n, read: true })) });
}

export function clearNotifications() {
  commit({ ...state, items: [] });
}

function followed(): number[] {
  const list = Object.entries(getMyListState().items)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => Number(id));
  const watching = continueItems(getProgressState()).map((it) => it.postId);
  return [...new Set([...watching, ...list])].slice(0, MAX_SHOWS);
}

let checking = false;
async function check() {
  if (checking || !navigator.onLine) return;
  checking = true;
  try {
    for (const id of followed()) {
      const meta = await loadMeta(id).catch(() => null);
      if (meta?.status !== "Currently Airing") continue;
      const list = await watchApi.episodes(id).catch(() => []);
      const latest = Math.max(0, ...list.map((e) => Number(e.number)).filter(Number.isFinite));
      if (!latest) continue;
      const seen = state.latest[id];
      const items =
        seen != null && latest > seen
          ? [
              { postId: id, title: meta.title, poster: meta.poster, episode: String(latest), at: Date.now(), read: false },
              ...state.items.filter((n) => n.postId !== id),
            ].slice(0, MAX_ITEMS)
          : state.items;
      if (seen !== latest || items !== state.items) commit({ latest: { ...state.latest, [id]: latest }, items });
    }
  } finally {
    checking = false;
  }
}

export function startNotifications() {
  setTimeout(check, 10000);
  setInterval(check, CHECK_EVERY);
}
