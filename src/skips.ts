// Intro / recap / credits timestamps. AniLab ids aren't MAL ids, so titles are matched to MAL
// through AniList's search (cached). Sources, in order:
// 1. AniSkip (anime-only, keyed by MAL id). Times are submitted per encode length: an encode within
//    5 s of ours is trusted for auto-skip, within 20 s only for a manual Skip button.
// 2. TheIntroDB (by TVDB id) and IntroDB (by IMDb id), general TV databases, fill in whatever
//    AniSkip lacks. public/skip-map.json (scripts/skip-map.mjs) gives each MAL entry's show id, season
//    and episode offset there. Their times come from other releases, so they only drive the Skip
//    button, unless both agree to within 3 s (then auto-skip is safe).

export type SkipKind = "intro" | "recap" | "credits";

export interface SkipSegment {
  kind: SkipKind;
  start: number;
  end: number;
  exact: boolean; // safe to auto-skip
}

export interface TitleLookup {
  postId: number;
  title: string;
  type?: string | null;
  premiered?: string | null;
}

export interface SkipLookup extends TitleLookup {
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

// banner: AniList's wide artwork (home hero, card fallbacks); missing in entries cached before it was kept.
type MalCache = Record<string, { mal: number; banner?: string | null; at: number }>;
type Match = { mal: number; banner: string | null };

function loadMalCache(): MalCache {
  try {
    return JSON.parse(localStorage.getItem(MAL_KEY) ?? "{}") as MalCache;
  } catch {
    return {};
  }
}

const malCache = loadMalCache();
const malPending = new Map<number, Promise<Match>>();
const skipCache = new Map<string, Promise<SkipSegment[]>>();

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

interface AniListMedia {
  idMal: number | null;
  format: string | null;
  seasonYear: number | null;
  title: { romaji: string | null; english: string | null };
  synonyms: string[] | null;
  bannerImage: string | null;
}

async function searchAniList(lookup: TitleLookup): Promise<Match> {
  const query = `query($s:String){Page(perPage:8){media(search:$s,type:ANIME){idMal format seasonYear title{romaji english} synonyms bannerImage}}}`;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables: { s: lookup.title } }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const media = ((await res.json()) as { data?: { Page?: { media?: AniListMedia[] } } }).data?.Page?.media ?? [];
  const year = Number(lookup.premiered?.match(/\d{4}/)?.[0]) || null;
  const formats = FORMATS[(lookup.type ?? "").toLowerCase().trim()] ?? [];
  let best: Match = { mal: 0, banner: null };
  let bestScore = 0;
  media.forEach((m, i) => {
    if (!m.idMal) return;
    let score = i === 0 ? 1 : 0;
    if (year && m.seasonYear === year) score += 3;
    if (m.format && formats.includes(m.format)) score += 2;
    if ([m.title.english, m.title.romaji, ...(m.synonyms ?? [])].map(norm).includes(norm(lookup.title))) score += 4;
    if (score > bestScore) {
      bestScore = score;
      best = { mal: m.idMal, banner: m.bannerImage };
    }
  });
  return bestScore >= 4 ? best : { mal: 0, banner: null };
}

function matchFor(lookup: TitleLookup): Promise<Match> {
  const cached = malCache[lookup.postId];
  if (cached && "banner" in cached && Date.now() - cached.at < (cached.mal ? HIT_TTL : MISS_TTL)) {
    return Promise.resolve({ mal: cached.mal, banner: cached.banner ?? null });
  }
  let pending = malPending.get(lookup.postId);
  if (!pending) {
    pending = searchAniList(lookup)
      .then((match) => {
        malCache[lookup.postId] = { ...match, at: Date.now() };
        try {
          localStorage.setItem(MAL_KEY, JSON.stringify(malCache));
        } catch {
          // ignore
        }
        return match;
      })
      .finally(() => malPending.delete(lookup.postId));
    malPending.set(lookup.postId, pending);
  }
  return pending;
}

const malIdFor = (lookup: TitleLookup) => matchFor(lookup).then((m) => m.mal);

/** Cached banner without a lookup (undefined: not looked up yet). */
export function cachedBanner(postId: number): string | null | undefined {
  const cached = malCache[postId];
  return cached && "banner" in cached ? (cached.banner ?? null) : undefined;
}

/** Wide banner artwork for a title (AniList), or null when there is none or no confident match. */
export function bannerFor(lookup: TitleLookup): Promise<string | null> {
  return matchFor(lookup)
    .then((m) => m.banner)
    .catch(() => null);
}

interface AniSkipResult {
  interval: { startTime: number; endTime: number };
  skipType: "op" | "ed" | "mixed-op" | "mixed-ed" | "recap";
  episodeLength: number;
}

const KIND: Record<AniSkipResult["skipType"], SkipKind> = { op: "intro", "mixed-op": "intro", recap: "recap", ed: "credits", "mixed-ed": "credits" };

async function aniSkip(mal: number, episode: number, duration: number): Promise<SkipSegment[]> {
  const types = ["op", "ed", "mixed-op", "mixed-ed", "recap"].map((t) => `types[]=${t}`).join("&");
  const res = await fetch(`https://api.aniskip.com/v2/skip-times/${mal}/${episode}?${types}&episodeLength=${Math.round(duration)}`);
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

// ---- fallback sources ----------------------------------------------------------------------------

/** [tvdbId, season (0 = absolute numbering), episodeOffset, imdbNumber] per MAL id. */
type ShowRef = [number, number, number, number];
let skipMap: Promise<Record<string, ShowRef>> | null = null;
function loadSkipMap(): Promise<Record<string, ShowRef>> {
  skipMap ??= fetch("/skip-map.json")
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, ShowRef>>) : {}))
    .catch(() => {
      skipMap = null; // try again next episode
      return {};
    });
  return skipMap;
}

const clampSeg = (kind: SkipKind, start: number | null, end: number | null, duration: number): SkipSegment | null => {
  const s = Math.max(0, start ?? 0);
  const e = Math.min(duration, end ?? duration);
  return e - s >= 5 && s < duration ? { kind, start: s, end: e, exact: false } : null;
};

interface TheIntroDBRange {
  start_ms: number | null;
  end_ms: number | null;
}

async function theIntroDB([tvdb, season, offset]: ShowRef, episode: number, duration: number): Promise<SkipSegment[]> {
  if (!tvdb) return [];
  const where = season ? `season=${season}&episode=${episode + offset}` : `season=1&episode=${episode + offset}&mapping=absolute`;
  const res = await fetch(`https://api.theintrodb.org/v4/media?tvdb_id=${tvdb}&${where}&duration_ms=${Math.round(duration * 1000)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as Partial<Record<"intro" | "recap" | "credits" | "preview", TheIntroDBRange[]>>;
  const first = (list: TheIntroDBRange[] | undefined, kind: SkipKind) =>
    list?.length ? clampSeg(kind, list[0].start_ms === null ? null : list[0].start_ms / 1000, list[0].end_ms === null ? null : list[0].end_ms / 1000, duration) : null;
  const credits = first(body.credits, "credits");
  // A "next episode" preview straight after the credits is skipped with them.
  const preview = first(body.preview, "credits");
  if (credits && preview && Math.abs(preview.start - credits.end) < 3) credits.end = preview.end;
  return [first(body.intro, "intro"), first(body.recap, "recap"), credits].filter((x): x is SkipSegment => !!x);
}

interface IntroDBRange {
  start_sec: number;
  end_sec: number;
}

async function introDB([, season, offset, imdb]: ShowRef, episode: number, duration: number): Promise<SkipSegment[]> {
  if (!imdb || !season) return []; // IntroDB has no absolute numbering
  const id = `tt${String(imdb).padStart(7, "0")}`;
  // Through the app's own server: IntroDB doesn't allow other sites to call it from a page.
  const res = await fetch(`/skips/introdb?imdb_id=${id}&season=${season}&episode=${episode + offset}`);
  if (!res.ok) return [];
  const body = (await res.json()) as Partial<Record<"intro" | "recap" | "outro", IntroDBRange | null>>;
  const seg = (r: IntroDBRange | null | undefined, kind: SkipKind) => (r ? clampSeg(kind, r.start_sec, r.end_sec, duration) : null);
  return [seg(body.intro, "intro"), seg(body.recap, "recap"), seg(body.outro, "credits")].filter((x): x is SkipSegment => !!x);
}

/** Fills the kinds AniSkip didn't have from the other sources. */
async function withFallbacks(mal: number, episode: number, duration: number, found: SkipSegment[]): Promise<SkipSegment[]> {
  const missing = (["intro", "recap", "credits"] as SkipKind[]).filter((k) => !found.some((s) => s.kind === k));
  if (!missing.length) return found;
  const ref = (await loadSkipMap())[mal];
  if (!ref) return found;
  const [a, b] = await Promise.all([theIntroDB(ref, episode, duration).catch(() => []), introDB(ref, episode, duration).catch(() => [])]);
  const out = [...found];
  for (const kind of missing) {
    const x = a.find((s) => s.kind === kind);
    const y = b.find((s) => s.kind === kind);
    const pick = x ?? y;
    if (!pick) continue;
    // Two independent databases agreeing means the times fit this video: safe to skip automatically.
    const agree = !!x && !!y && Math.abs(x.start - y.start) <= 3 && Math.abs(x.end - y.end) <= 3;
    out.push({ ...pick, exact: agree });
  }
  return out.sort((p, q) => p.start - q.start);
}

async function loadSkips(lookup: SkipLookup, duration: number): Promise<SkipSegment[]> {
  const mal = await malIdFor(lookup);
  if (!mal || !lookup.episode) return [];
  const found = await aniSkip(mal, lookup.episode, duration).catch(() => []);
  return withFallbacks(mal, lookup.episode, duration, found);
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
