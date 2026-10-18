// Intro / recap / credits timestamps from AniSkip (community dataset keyed by MyAnimeList id).
// AniLab ids aren't MAL ids, so titles are matched to MAL through AniList's search (cached).
// AniSkip is asked for times submitted on an encode of the same length as ours; times from an
// encode within 5 s are trusted for auto-skip, within 20 s only for a manual Skip button.

export type SkipKind = "intro" | "recap" | "credits";

export interface SkipSegment {
  kind: SkipKind;
  start: number;
  end: number;
  exact: boolean; // safe to auto-skip
}

export interface SkipLookup {
  postId: number;
  title: string;
  type?: string | null;
  premiered?: string | null;
  episode: number; // 1-based within this title (AniLab numbers sequels continuously)
}

const MAL_KEY = "anilab.malIds";
const HIT_TTL = 30 * 86400000;
const MISS_TTL = 3 * 86400000;
const EXACT_DELTA = 5;
const MAX_DELTA = 20;

const FORMATS: Record<string, string[]> = {
  tv: ["TV", "TV_SHORT"],
  movie: ["MOVIE"],
  ona: ["ONA"],
  ova: ["OVA"],
  special: ["SPECIAL", "TV_SHORT"],
  "tv special": ["SPECIAL", "TV_SHORT"],
};

type MalCache = Record<string, { mal: number; at: number }>;

function loadMalCache(): MalCache {
  try {
    return JSON.parse(localStorage.getItem(MAL_KEY) ?? "{}") as MalCache;
  } catch {
    return {};
  }
}

const malCache = loadMalCache();
const malPending = new Map<number, Promise<number>>();
const skipCache = new Map<string, Promise<SkipSegment[]>>();

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

interface AniListMedia {
  idMal: number | null;
  format: string | null;
  seasonYear: number | null;
  title: { romaji: string | null; english: string | null };
  synonyms: string[] | null;
}

async function searchMal(lookup: SkipLookup): Promise<number> {
  const query = `query($s:String){Page(perPage:8){media(search:$s,type:ANIME){idMal format seasonYear title{romaji english} synonyms}}}`;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables: { s: lookup.title } }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const media = ((await res.json()) as { data?: { Page?: { media?: AniListMedia[] } } }).data?.Page?.media ?? [];
  const year = Number(lookup.premiered?.match(/\d{4}/)?.[0]) || null;
  const formats = FORMATS[(lookup.type ?? "").toLowerCase().trim()] ?? [];
  let best = 0;
  let bestScore = 0;
  media.forEach((m, i) => {
    if (!m.idMal) return;
    let score = i === 0 ? 1 : 0;
    if (year && m.seasonYear === year) score += 3;
    if (m.format && formats.includes(m.format)) score += 2;
    if ([m.title.english, m.title.romaji, ...(m.synonyms ?? [])].map(norm).includes(norm(lookup.title))) score += 4;
    if (score > bestScore) {
      bestScore = score;
      best = m.idMal;
    }
  });
  return bestScore >= 4 ? best : 0;
}

function malIdFor(lookup: SkipLookup): Promise<number> {
  const cached = malCache[lookup.postId];
  if (cached && Date.now() - cached.at < (cached.mal ? HIT_TTL : MISS_TTL)) return Promise.resolve(cached.mal);
  let pending = malPending.get(lookup.postId);
  if (!pending) {
    pending = searchMal(lookup)
      .then((mal) => {
        malCache[lookup.postId] = { mal, at: Date.now() };
        try {
          localStorage.setItem(MAL_KEY, JSON.stringify(malCache));
        } catch {
          // ignore
        }
        return mal;
      })
      .finally(() => malPending.delete(lookup.postId));
    malPending.set(lookup.postId, pending);
  }
  return pending;
}

interface AniSkipResult {
  interval: { startTime: number; endTime: number };
  skipType: "op" | "ed" | "mixed-op" | "mixed-ed" | "recap";
  episodeLength: number;
}

const KIND: Record<AniSkipResult["skipType"], SkipKind> = { op: "intro", "mixed-op": "intro", recap: "recap", ed: "credits", "mixed-ed": "credits" };

async function loadSkips(lookup: SkipLookup, duration: number): Promise<SkipSegment[]> {
  const mal = await malIdFor(lookup);
  if (!mal || !lookup.episode) return [];
  const types = ["op", "ed", "mixed-op", "mixed-ed", "recap"].map((t) => `types[]=${t}`).join("&");
  const res = await fetch(`https://api.aniskip.com/v2/skip-times/${mal}/${lookup.episode}?${types}&episodeLength=${Math.round(duration)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`AniSkip ${res.status}`);
  const results = ((await res.json()) as { results?: AniSkipResult[] }).results ?? [];
  const byKind = new Map<SkipKind, { seg: SkipSegment; delta: number }>();
  for (const r of results) {
    const delta = Math.abs(r.episodeLength - duration);
    const kind = KIND[r.skipType];
    if (!kind || delta > MAX_DELTA) continue;
    const start = Math.max(0, r.interval.startTime);
    const end = Math.min(duration, r.interval.endTime);
    if (end - start < 5) continue;
    const prev = byKind.get(kind);
    if (!prev || delta < prev.delta) byKind.set(kind, { seg: { kind, start, end, exact: delta <= EXACT_DELTA }, delta });
  }
  return [...byKind.values()].map((v) => v.seg).sort((a, b) => a.start - b.start);
}

export function fetchSkips(lookup: SkipLookup, duration: number): Promise<SkipSegment[]> {
  const key = `${lookup.postId}:${lookup.episode}:${Math.round(duration)}`;
  let p = skipCache.get(key);
  if (!p) {
    p = loadSkips(lookup, duration).catch(() => {
      skipCache.delete(key); // network hiccup: try again next time
      return [];
    });
    skipCache.set(key, p);
  }
  return p;
}

export const SKIP_LABEL: Record<SkipKind, string> = { intro: "Skip Intro", recap: "Skip Recap", credits: "Skip Credits" };
