// Episodes saved for offline viewing. The Windows and Android apps download them natively
// (desktop/downloads.go, android/.../Downloads.java) and serve them back under /downloads; this
// module is the page's view of that list. In a plain browser (dev server) there is no /downloads
// and `supported` stays false.
import { useEffect, useSyncExternalStore } from "react";
import type { Episode } from "./api";

export interface Download {
  id: string;
  postId: string;
  title: string;
  poster: string;
  episodeId: string;
  number: string;
  name: string;
  lang: "sub" | "dub";
  quality: number;
  height: number;
  status: "queued" | "downloading" | "paused" | "done" | "error";
  error?: string;
  segments: number;
  done: number;
  bytes: number;
  duration: number;
  added: number;
}

interface State {
  supported: boolean | null; // null until the first answer
  items: Download[];
  dir: string;
}

let state: State = { supported: null, items: [], dir: "" };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

async function call(path: string, params?: Record<string, string>): Promise<void> {
  const res = await fetch(`/downloads/${path}${params ? `?${new URLSearchParams(params)}` : ""}`, { cache: "no-store" });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    set({ supported: false }); // the SPA's index.html: this build has no downloads
    return;
  }
  const body = (await res.json()) as { items?: Download[]; dir?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  if (body.items) set({ supported: true, items: body.items, dir: body.dir ?? state.dir });
}

// Poll fast while something is downloading, slowly otherwise, and only while someone is watching.
let timer = 0;
let watchers = 0;
function schedule() {
  window.clearTimeout(timer);
  if (!watchers || state.supported === false) return;
  const busy = state.items.some((d) => d.status === "downloading" || d.status === "queued");
  timer = window.setTimeout(refresh, busy ? 1000 : 8000);
}
export function refresh(): Promise<void> {
  return call("list")
    .catch(() => {})
    .finally(schedule);
}

export function useDownloads(): State {
  useEffect(() => {
    if (watchers++ === 0) refresh();
    return () => {
      if (--watchers === 0) window.clearTimeout(timer);
    };
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export interface DownloadRequest {
  postId: number;
  title: string;
  poster: string;
  lang: "sub" | "dub";
  quality: number;
  episodes: Episode[];
}

export async function addDownloads(r: DownloadRequest): Promise<void> {
  // A few hundred episodes per request keeps the URL a sensible length.
  for (let i = 0; i < r.episodes.length; i += 150) {
    const eps = r.episodes.slice(i, i + 150).map((e) => ({ id: e.id, number: e.number, name: e.name === `Episode ${e.number}` ? "" : e.name }));
    await call("add", { post: String(r.postId), title: r.title, poster: r.poster, lang: r.lang, quality: String(r.quality), eps: JSON.stringify(eps) });
  }
  schedule();
}

export async function downloadAction(action: "pause" | "resume" | "delete", ids: string[]): Promise<void> {
  if (!ids.length) return;
  await call("action", { do: action, ids: ids.join(",") });
  schedule();
}

export const openDownloadsFolder = () => fetch("/downloads/open").catch(() => {});

/** The finished download of an episode, preferring the wanted language. */
export function downloadedEpisode(items: Download[], postId: number, episodeId: string, lang?: string): Download | undefined {
  const done = items.filter((d) => d.status === "done" && d.postId === String(postId) && d.episodeId === episodeId);
  return done.find((d) => d.lang === lang) ?? done[0];
}

export const mediaUrl = (d: Download) => `/downloads/media/${encodeURIComponent(d.id)}/index.m3u8`;

export function formatBytes(n: number): string {
  if (n < 1024 ** 2) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 100 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Estimated final size from what is downloaded so far. */
export const expectedBytes = (d: Download) => (d.status === "done" || !d.done ? d.bytes : (d.bytes / d.done) * d.segments);

export const QUALITIES = [1080, 720, 480, 360];
