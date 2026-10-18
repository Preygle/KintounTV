// Client for the AniLab API. Shapes mirror the app's models (com.android.app.models / network.responses);
// requests go through the /api proxy (vite dev proxy or server.mjs), which adds the app's headers.

export interface Post {
  id: number;
  poster: string;
  age: string | null;
}

export interface Featured {
  id: number;
  type: string | null;
  title: string;
  poster: string;
  status: string | null;
  runtime: string | null;
  premiered: string | null;
  rating: string | null;
  age: string | null;
  score: string | number | null;
  genres: string | null;
  share: string | null;
}

export interface Section {
  name: string;
  posts: Post[];
}

export interface Category {
  id: number;
  name: string;
}

export interface Season {
  id: number;
  poster: string;
  title: string;
}

export interface PostDetail extends Featured {
  overview: string | null;
  seasons: Season[] | null;
  related: Post[] | null;
  similar: Post[] | null;
  isDemo: boolean;
}

export interface HomeResponse {
  featured: Featured | null;
  sections: Section[];
}

export interface PostsResponse {
  posts: Post[];
}

// GET responses are kept briefly so going back to a page renders instantly; concurrent
// identical requests share one fetch. Failed requests are evicted so a retry refetches.
const CACHE_TTL_MS = 3 * 60 * 1000;
const getCache = new Map<string, { at: number; promise: Promise<unknown> }>();

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res
      .json()
      .then((j: { error?: string }) => j.error)
      .catch(() => null);
    throw new Error(detail ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function request<T>(path: string, params: Record<string, string | number> = {}, body?: unknown): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const url = `${path}${query ? `?${query}` : ""}`;
  if (body !== undefined) {
    return fetchJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  const hit = getCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise as Promise<T>;
  const promise = fetchJson<T>(url);
  getCache.set(url, { at: Date.now(), promise });
  promise.catch(() => getCache.delete(url));
  return promise;
}

// Streaming (KYOTO Player's flow, served by the desktop app / server.mjs under /stream).
export interface Episode {
  id: string;
  name: string;
  number: string;
  filler: boolean;
}

export interface Server {
  id: string;
  lang: string;
  name: string;
}

export const watchApi = {
  episodes: (postId: number) => request<{ list: Episode[] }>("/stream/episodes", { id: postId }).then((r) => r.list ?? []),
  servers: (postId: number, episodeId: string) =>
    request<{ list: Server[] }>("/stream/servers", { id: postId, episode: episodeId }).then((r) => r.list ?? []),
  // Not cached: links can be short-lived.
  source: (postId: number, serverId: string) =>
    fetchJson<{ url: string }>(`/stream/source?${new URLSearchParams({ id: String(postId), server: serverId })}`).then((r) => r.url),
};

export const api = {
  home: () => request<HomeResponse>("/api/home"),
  categories: () => request<{ categories: Category[] }>("/api/categories").then((r) => r.categories),
  post: (id: number) => request<PostDetail>("/api/post", { id }),
  latest: (page: number) => request<PostsResponse>("/api/latest", { page }).then((r) => r.posts),
  category: (id: number, page: number) => request<PostsResponse>("/api/category", { id, page }).then((r) => r.posts),
  search: (query: string, page: number) => request<PostsResponse>("/api/search", { query, page }).then((r) => r.posts),
  // GET (not POST) so the Android app can serve it from an intercepted request.
  myList: (ids: number[], page: number) => request<PostsResponse>("/api/list", { page, ids: ids.join(",") }).then((r) => r.posts),
};
