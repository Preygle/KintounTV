// Per-title details for cards. Catalog lists only carry an id and a poster, so each card's title,
// rating, format, genres and episode count are looked up per title as the card scrolls into view,
// a few at a time, and cached on the device so revisits are instant.
import { useEffect, useState } from "react";
import { api, watchApi, type Featured } from "./api";
import { bannerFor, cachedBanner } from "./skips";

export interface PostMeta {
  id: number;
  title: string;
  type: string | null; // TV, Movie, OVA, ONA, Special
  score: number | null;
  status: string | null; // Currently Airing, Finished Airing, Not yet aired
  genres: string[];
  premiered: string | null; // "Spring 2013"
  year: number | null;
  runtime: string | null;
  age: string | null;
  poster: string;
}

/** Genre filters offered on Home (Trending) and Search. */
export const GENRES = ["All", "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Romance", "Slice of Life"];

const META_KEY = "kintoun.meta";
const EPISODES_KEY = "kintoun.episodes";
const META_TTL = 24 * 3600000;
const EPISODES_TTL_AIRING = 3 * 3600000;
const EPISODES_TTL = 7 * 24 * 3600000;
const MAX_ENTRIES = 1500;

function load<T>(key: string): Map<number, T> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, T>).map(([k, v]) => [Number(k), v]));
  } catch {
    return new Map();
  }
}

const metas = load<{ m: PostMeta; at: number }>(META_KEY);
const episodes = load<{ n: number; at: number; airing: boolean }>(EPISODES_KEY);
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    for (const [key, map] of [
      [META_KEY, metas],
      [EPISODES_KEY, episodes],
    ] as const) {
      const recent = [...map.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
      try {
        localStorage.setItem(key, JSON.stringify(Object.fromEntries(recent)));
      } catch {
        // storage full: the cache is only an optimisation
      }
    }
  }, 1000);
}

/** A few requests at a time, so a page of cards doesn't flood the catalog. */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    while (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const metaQueue = limiter(6);
const episodeQueue = limiter(2);

export function toMeta(p: Featured): PostMeta {
  const score = Number(p.score);
  return {
    id: p.id,
    title: p.title,
    type: p.type,
    score: Number.isFinite(score) && score > 0 ? score : null,
    status: p.status,
    genres: (p.genres ?? "").split(",").map((g) => g.trim()).filter(Boolean),
    premiered: p.premiered,
    year: Number(p.premiered?.match(/\d{4}/)?.[0]) || null,
    runtime: p.runtime,
    age: p.age,
    poster: p.poster,
  };
}

/** Records details already in hand (a detail page, the featured title) so cards don't refetch them. */
export function rememberMeta(p: Featured) {
  metas.set(p.id, { m: toMeta(p), at: Date.now() });
  persist();
}

export function cachedMeta(id: number): PostMeta | null {
  const hit = metas.get(id);
  return hit && Date.now() - hit.at < META_TTL ? hit.m : null;
}

const metaPending = new Map<number, Promise<PostMeta>>();
export function loadMeta(id: number): Promise<PostMeta> {
  const hit = cachedMeta(id);
  if (hit) return Promise.resolve(hit);
  let p = metaPending.get(id);
  if (!p) {
    p = metaQueue(() => api.post(id))
      .then((detail) => {
        rememberMeta(detail);
        return toMeta(detail);
      })
      .finally(() => metaPending.delete(id));
    metaPending.set(id, p);
  }
  return p;
}

export function cachedEpisodes(id: number): number | null {
  const hit = episodes.get(id);
  return hit && Date.now() - hit.at < (hit.airing ? EPISODES_TTL_AIRING : EPISODES_TTL) ? hit.n : null;
}

const episodesPending = new Map<number, Promise<number | null>>();
/** Episode count from the streaming source; `fresh` skips the device cache (new-episode checks). */
export function loadEpisodes(id: number, fresh = false): Promise<number | null> {
  const hit = fresh ? null : cachedEpisodes(id);
  if (hit != null) return Promise.resolve(hit);
  let p = episodesPending.get(id);
  if (!p) {
    p = episodeQueue(() => watchApi.episodes(id))
      .then((list) => {
        if (!list.length) return null;
        episodes.set(id, { n: list.length, at: Date.now(), airing: cachedMeta(id)?.status === "Currently Airing" });
        persist();
        return list.length;
      })
      .catch(() => null)
      .finally(() => episodesPending.delete(id));
    episodesPending.set(id, p);
  }
  return p;
}

// One shared observer: cards ask for their data when they come within a screen of the viewport.
const visibleCallbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;
function whenVisible(el: Element, cb: () => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer!.unobserve(e.target);
        visibleCallbacks.get(e.target)?.();
        visibleCallbacks.delete(e.target);
      }
    },
    { rootMargin: "300px" },
  );
  visibleCallbacks.set(el, cb);
  observer.observe(el);
  return () => {
    visibleCallbacks.delete(el);
    observer?.unobserve(el);
  };
}

/** Details for a card, loaded once `ref` is near the viewport (immediately without a ref). */
export function useMeta(id: number, ref?: React.RefObject<Element>, enabled = true): PostMeta | null {
  const [meta, setMeta] = useState(() => cachedMeta(id));
  useEffect(() => {
    const hit = enabled ? cachedMeta(id) : null;
    setMeta(hit);
    if (hit || !enabled) return;
    let live = true;
    const fetch = () => loadMeta(id).then((m) => live && setMeta(m), () => {});
    const stop = ref?.current ? whenVisible(ref.current, fetch) : (fetch(), undefined);
    return () => {
      live = false;
      stop?.();
    };
  }, [id, ref, enabled]);
  return meta;
}

/** Episode count for a card, loaded once `ref` is near the viewport; skipped when `wanted` is false. */
export function useEpisodeCount(id: number, ref: React.RefObject<Element> | undefined, wanted = true): number | null {
  const [count, setCount] = useState(() => cachedEpisodes(id));
  useEffect(() => {
    const hit = cachedEpisodes(id);
    setCount(hit);
    if (hit != null || !wanted) return;
    let live = true;
    const fetch = () => loadEpisodes(id).then((n) => live && setCount(n));
    const stop = ref?.current ? whenVisible(ref.current, fetch) : (fetch(), undefined);
    return () => {
      live = false;
      stop?.();
    };
  }, [id, ref, wanted]);
  return count;
}

/** Details for a whole list at once (filters need every item's genres); `enabled` defers the work. */
export function useMetas(ids: number[], enabled: boolean): { metas: Map<number, PostMeta>; pending: number } {
  const key = ids.join(",");
  const [state, setState] = useState<{ key: string; metas: Map<number, PostMeta>; failed: number }>({ key: "", metas: new Map(), failed: 0 });
  useEffect(() => {
    const known = new Map<number, PostMeta>();
    for (const id of ids) {
      const hit = cachedMeta(id);
      if (hit) known.set(id, hit);
    }
    setState({ key, metas: known, failed: 0 });
    if (!enabled) return;
    let live = true;
    for (const id of ids) {
      if (known.has(id)) continue;
      loadMeta(id).then(
        (m) => live && setState((s) => (s.key === key ? { ...s, metas: new Map(s.metas).set(id, m) } : s)),
        () => live && setState((s) => (s.key === key ? { ...s, failed: s.failed + 1 } : s)),
      );
    }
    return () => {
      live = false;
    };
  }, [key, enabled]);
  const current = state.key === key;
  const metasNow = current ? state.metas : new Map<number, PostMeta>();
  return { metas: metasNow, pending: Math.max(0, ids.length - metasNow.size - (current ? state.failed : 0)) };
}

/** Wide artwork for a title (AniList banner), or null; looked up only while `enabled`. */
export function useBanner(postId: number, title: string | undefined, enabled = true): string | null {
  const [banner, setBanner] = useState(() => cachedBanner(postId) ?? null);
  useEffect(() => {
    const hit = cachedBanner(postId);
    setBanner(hit ?? null);
    if (hit !== undefined || !enabled || !title) return;
    let live = true;
    const meta = cachedMeta(postId);
    bannerFor({ postId, title, type: meta?.type, premiered: meta?.premiered }).then((b) => live && setBanner(b));
    return () => {
      live = false;
    };
  }, [postId, title, enabled]);
  return banner;
}
