// "My List" is stored on-device in the app (DataStore); here it lives in localStorage.
// Adds and removals are timestamped so lists from different devices merge correctly (sync.ts).
import { useSyncExternalStore } from "react";

const KEY = "anilab.myList2";
const LEGACY_KEY = "anilab.myList"; // plain id array (before sync)
const TOMBSTONE_TTL = 120 * 86400000;

export interface MyListState {
  items: Record<string, number>; // id -> added at
  removed: Record<string, number>; // id -> removed at
}

const listeners = new Set<() => void>();

function read(): MyListState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { items: parsed.items ?? {}, removed: parsed.removed ?? {} };
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    const items: Record<string, number> = {};
    // Newest first in the old array; keep that order with descending timestamps.
    if (Array.isArray(legacy)) legacy.filter((n) => Number.isInteger(n)).forEach((id, i) => (items[id] = Date.now() - i * 1000));
    return { items, removed: {} };
  } catch {
    return { items: {}, removed: {} };
  }
}

let state = read();
let ids = toIds(state);

function toIds(s: MyListState): number[] {
  return Object.entries(s.items)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => Number(id));
}

function write(next: MyListState) {
  state = next;
  ids = toIds(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode); keep the in-memory list for this session.
  }
  listeners.forEach((l) => l());
}

export function toggleMyList(id: number) {
  const items = { ...state.items };
  const removed = { ...state.removed };
  if (items[id]) {
    delete items[id];
    removed[id] = Date.now();
  } else {
    items[id] = Date.now();
    delete removed[id];
  }
  write({ items, removed });
}

export function useMyList(): number[] {
  return useSyncExternalStore(subscribeMyList, () => ids);
}

export function subscribeMyList(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getMyListState(): MyListState {
  return state;
}

// Union of both sides; for each id the newest add/remove wins.
export function mergeMyList(a: MyListState, b: MyListState): MyListState {
  const items: Record<string, number> = {};
  const removed: Record<string, number> = {};
  const ids = new Set([...Object.keys(a.items), ...Object.keys(b.items), ...Object.keys(a.removed), ...Object.keys(b.removed)]);
  const cutoff = Date.now() - TOMBSTONE_TTL;
  for (const id of ids) {
    const added = Math.max(a.items[id] ?? 0, b.items[id] ?? 0);
    const gone = Math.max(a.removed[id] ?? 0, b.removed[id] ?? 0);
    if (added > gone) items[id] = added;
    else if (gone > cutoff) removed[id] = gone;
  }
  return { items, removed };
}

export function replaceMyList(next: MyListState) {
  write(next);
}

window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    state = read();
    ids = toIds(state);
    listeners.forEach((l) => l());
  }
});
