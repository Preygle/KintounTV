// Titles matching several categories at once. The catalog lists one category at a time (30 titles
// a page, best-rated first), so selections are combined here:
// - "any" (OR) merges the lists page by page, ranking each title by its best position;
// - "all" (AND) reads every selected list to the end (categories hold up to ~2,500 titles, so the
//   tops of the lists rarely overlap) and keeps titles found in all of them, ranked by their total
//   position. Matches appear as soon as they are confirmed.
// Pages download in parallel and are kept for half an hour, so other combinations reuse them.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Post } from "./api";

export type MatchMode = "any" | "all";

interface List {
  pages: Map<number, Post[]>;
  top: number; // highest page requested
  end: number | null; // first empty page, once seen
  at: number;
}

const LIST_TTL = 30 * 60000;
const PARALLEL = 6;
const lists = new Map<number, List>();
const inFlight = new Map<string, Promise<void>>();

function listOf(id: number): List {
  const hit = lists.get(id);
  if (hit && Date.now() - hit.at < LIST_TTL) return hit;
  const fresh: List = { pages: new Map(), top: 0, end: null, at: Date.now() };
  lists.set(id, fresh);
  return fresh;
}

/** The list's titles in order, up to the first page not loaded yet. */
function postsOf(id: number): Post[] {
  const list = listOf(id);
  const out: Post[] = [];
  for (let n = 1; list.pages.has(n); n++) out.push(...list.pages.get(n)!);
  return out;
}

function isDone(id: number): boolean {
  const list = listOf(id);
  if (list.end === null) return false;
  for (let n = 1; n < list.end; n++) if (!list.pages.has(n)) return false;
  return true;
}

/** The next page worth requesting: a gap left by a failed request, else the page after the last. */
function wantedPage(id: number): number | null {
  const list = listOf(id);
  const limit = list.end ?? list.top + 2;
  for (let n = 1; n < limit; n++) if (!list.pages.has(n) && !inFlight.has(`${id}:${n}`)) return n;
  return null;
}

function fetchPage(id: number, n: number): Promise<void> {
  const key = `${id}:${n}`;
  let p = inFlight.get(key);
  if (!p) {
    const list = listOf(id);
    list.top = Math.max(list.top, n);
    p = api
      .category(id, n)
      .then((posts) => {
        if (posts.length) list.pages.set(n, posts);
        else list.end = Math.min(list.end ?? n, n);
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return p;
}

export interface TagResults {
  items: Post[];
  loading: boolean;
  error: string | null;
  done: boolean; // every selected list read to the end
  checked: number; // titles read so far across the selected lists
  more: () => void; // OR: next page of each list; AND: resume after an error
}

/** tags: each tag is one category, possibly listed under several catalog ids. */
export function useTagResults(tags: number[][], mode: MatchMode): TagResults {
  const key = JSON.stringify([tags, mode]);
  const catIds = [...new Set(tags.flat())];
  const readAll = mode === "all" && tags.length > 1;
  const [, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const gen = generation.current;
    const live = () => gen === generation.current;
    setLoading(true);
    setError(null);
    let active = 0;
    let failed = false;
    const start = (id: number, n: number, then: () => void) => {
      active++;
      fetchPage(id, n).then(
        () => {
          active--;
          if (!live()) return;
          setVersion((v) => v + 1);
          then();
        },
        (err: unknown) => {
          active--;
          failed = true;
          if (live()) {
            setError(String((err as Error)?.message ?? err));
            setLoading(false);
          }
        },
      );
    };
    const settle = () => {
      if (!active && !failed && live()) setLoading(false);
    };

    if (!readAll) {
      // OR: one more page of every list.
      for (const id of catIds) {
        const n = wantedPage(id);
        if (n !== null) start(id, n, settle);
      }
      settle();
      return;
    }
    // AND: keep PARALLEL requests going, round-robin over the lists, until every list is read.
    const pump = () => {
      if (!live() || failed) return;
      let progressed = true;
      while (active < PARALLEL && progressed) {
        progressed = false;
        for (const id of catIds) {
          if (active >= PARALLEL) break;
          const n = wantedPage(id);
          if (n === null) continue;
          progressed = true;
          start(id, n, pump);
        }
      }
      if (!active) {
        // Pages already being fetched for an earlier search: wait for them, then carry on.
        const shared = [...inFlight].filter(([k]) => catIds.includes(Number(k.split(":")[0]))).map(([, p]) => p);
        if (shared.length) {
          active++;
          Promise.allSettled(shared).then(() => {
            active--;
            if (!live()) return;
            setVersion((v) => v + 1);
            pump();
          });
          return;
        }
      }
      settle();
    };
    pump();
  }, [key]);

  useEffect(() => {
    generation.current++;
    if (catIds.length && (readAll || catIds.some((id) => !listOf(id).pages.size))) load();
    else setVersion((v) => v + 1);
    return () => {
      generation.current++;
    };
  }, [key, load]);

  // Rank and combine what has been read so far.
  const position = new Map<number, Map<number, number>>(); // catId -> postId -> index
  const posts = new Map<number, Post>();
  for (const id of catIds) {
    const m = new Map<number, number>();
    postsOf(id).forEach((p, i) => {
      if (!m.has(p.id)) m.set(p.id, i);
      posts.set(p.id, p);
    });
    position.set(id, m);
  }
  const rankInTag = (tag: number[], postId: number) => Math.min(...tag.map((id) => position.get(id)?.get(postId) ?? Infinity));
  const scored: { post: Post; score: number }[] = [];
  for (const post of posts.values()) {
    const ranks = tags.map((tag) => rankInTag(tag, post.id));
    if (readAll) {
      if (ranks.every(Number.isFinite)) scored.push({ post, score: ranks.reduce((a, b) => a + b, 0) });
    } else {
      scored.push({ post, score: Math.min(...ranks) });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.post.id - b.post.id);

  return {
    items: scored.map((s) => s.post),
    loading,
    error,
    done: catIds.length > 0 && catIds.every(isDone),
    checked: catIds.reduce((n, id) => n + postsOf(id).length, 0),
    more: load,
  };
}
