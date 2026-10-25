// Seek-bar previews, Netflix-style. The video CDN publishes I-frame playlists
// (#EXT-X-I-FRAME-STREAM-INF): every keyframe of the episode as a byte range of a TS segment. A
// preview fetches the keyframe nearest the hovered time (20–40 KB at 360p), pulls the H.264 out of the
// TS packets and decodes it with WebCodecs. Frames are kept for the episode, so going back over the
// bar is instant. Without an I-frame playlist or WebCodecs the bar shows just the time, as before.
import { useEffect, useRef, useState } from "react";

interface Keyframe {
  start: number;
  url: string;
  offset: number;
  length: number;
}

const PREVIEW_WIDTH = 320;
const MIN_HEIGHT = 270; // smallest I-frame rendition that still looks sharp in the preview

function attributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) out[m[1]] = m[2].replace(/^"|"$/g, "");
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function keyframes(src: string): Promise<Keyframe[] | null> {
  const masterUrl = new URL(src, location.href);
  const master = await fetchText(masterUrl.href);
  const renditions = master
    .split(/\r?\n/)
    .filter((l) => l.startsWith("#EXT-X-I-FRAME-STREAM-INF:"))
    .map((l) => {
      const a = attributes(l.slice(l.indexOf(":") + 1));
      return { uri: a.URI, height: Number(a.RESOLUTION?.split("x")[1]) || 0 };
    })
    .filter((r) => r.uri)
    .sort((a, b) => a.height - b.height);
  const pick = renditions.find((r) => r.height >= MIN_HEIGHT) ?? renditions[renditions.length - 1];
  if (!pick) return null;

  const listUrl = new URL(pick.uri, masterUrl);
  const list = await fetchText(listUrl.href);
  const out: Keyframe[] = [];
  const ends = new Map<string, number>(); // a byte range without "@offset" continues the previous one
  let start = 0;
  let duration = 0;
  let range: { length: number; offset: number | null } | null = null;
  for (const line of list.split(/\r?\n/)) {
    if (line.startsWith("#EXTINF:")) duration = parseFloat(line.slice(8)) || 0;
    else if (line.startsWith("#EXT-X-BYTERANGE:")) {
      const [length, offset] = line.slice(17).split("@");
      range = { length: Number(length), offset: offset === undefined ? null : Number(offset) };
    } else if (line && !line.startsWith("#")) {
      const url = new URL(line, listUrl).href;
      if (range) {
        const offset = range.offset ?? ends.get(url) ?? 0;
        out.push({ start, url, offset, length: range.length });
        ends.set(url, offset + range.length);
      }
      start += duration;
      duration = 0;
      range = null;
    }
  }
  return out.length ? out : null;
}

/** The H.264 stream (Annex B) carried in a run of TS packets. */
function h264FromTs(ts: Uint8Array): Uint8Array | null {
  let i = 0;
  while (i + 188 < ts.length && !(ts[i] === 0x47 && ts[i + 188] === 0x47)) i++;
  let videoPid = -1;
  const parts: Uint8Array[] = [];
  let size = 0;
  for (; i + 188 <= ts.length; i += 188) {
    if (ts[i] !== 0x47) break;
    const unitStart = (ts[i + 1] & 0x40) !== 0;
    const pid = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
    const adaptation = (ts[i + 3] >> 4) & 3;
    if (adaptation === 2) continue; // no payload
    let p = i + 4;
    if (adaptation === 3) p += 1 + ts[p];
    if (unitStart && ts[p] === 0 && ts[p + 1] === 0 && ts[p + 2] === 1 && (ts[p + 3] & 0xf0) === 0xe0) {
      if (videoPid < 0) videoPid = pid; // first video PES (stream ids 0xE0–0xEF)
      if (pid === videoPid) p += 9 + ts[p + 8]; // skip the PES header
    }
    if (pid !== videoPid || p >= i + 188) continue;
    parts.push(ts.subarray(p, i + 188));
    size += i + 188 - p;
  }
  if (!size) return null;
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** "avc1.PPCCLL" from the stream's SPS, so the decoder is configured for what is really there. */
function codecOf(h264: Uint8Array): string {
  for (let i = 0; i + 6 < h264.length; i++) {
    if (h264[i] === 0 && h264[i + 1] === 0 && h264[i + 2] === 1 && (h264[i + 3] & 0x1f) === 7) {
      return `avc1.${[...h264.subarray(i + 4, i + 7)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "avc1.640028";
}

function decode(h264: Uint8Array): Promise<VideoFrame> {
  return new Promise((resolve, reject) => {
    let frame: VideoFrame | null = null;
    const decoder = new VideoDecoder({
      output: (f) => {
        frame?.close();
        frame = f;
      },
      error: (e) => reject(e),
    });
    // No description: the decoder reads SPS/PPS from the stream itself (Annex B).
    decoder.configure({ codec: codecOf(h264), optimizeForLatency: true });
    decoder.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: h264 }));
    decoder
      .flush()
      .then(() => (frame ? resolve(frame) : reject(new Error("no frame"))), reject)
      .finally(() => decoder.state !== "closed" && decoder.close());
  });
}

async function toImage(frame: VideoFrame): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_WIDTH;
    canvas.height = Math.round((PREVIEW_WIDTH * frame.displayHeight) / frame.displayWidth) || 180;
    canvas.getContext("2d")!.drawImage(frame, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
    if (!blob) throw new Error("encode failed");
    return URL.createObjectURL(blob);
  } finally {
    frame.close();
  }
}

class Trickplay {
  private frames = new Map<number, string>();
  private loading = new Set<number>();
  private wanted: number | null = null; // where the viewer is pointing: always loaded next
  private prefetch: number[] = []; // a coarse grid over the episode, filled in the background
  private listeners = new Set<() => void>();
  private failures = 0;
  broken = false;

  constructor(private list: Keyframe[]) {}

  indexAt(t: number): number {
    let lo = 0;
    let hi = this.list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.list[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Called whenever a frame arrives (or previews turn out to be impossible). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The decoded frame closest to `index`, if one is within a sensible distance (20 s, or 4% of the
   * episode on long ones) — so a fast drag shows nearby frames instead of nothing.
   */
  nearest(index: number): string | undefined {
    const at = this.list[index]?.start ?? 0;
    const span = Math.max(20, 0.04 * (this.list[this.list.length - 1]?.start ?? 0));
    for (let d = 0; d < this.list.length; d++) {
      const lo = index - d;
      const hi = index + d;
      if ((lo < 0 || at - this.list[lo].start > span) && (hi >= this.list.length || this.list[hi].start - at > span)) break;
      const hit = (lo >= 0 && this.frames.get(lo)) || (hi < this.list.length && this.frames.get(hi));
      if (hit) return hit;
    }
    return undefined;
  }

  /** Load this position next (replacing the previous wish; frames already on the way still land). */
  want(index: number) {
    if (!this.frames.has(index)) this.wanted = index;
    this.pump();
  }

  /** Background loading of ~48 frames across the episode, coarse to fine, behind `want`. */
  startPrefetch(count = 48) {
    if (this.prefetch.length) return;
    const n = this.list.length;
    const grid = Array.from({ length: Math.min(count, n) }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, Math.min(count, n) - 1)));
    // Bit-reversed order: halves, then quarters, … so coverage is even at every moment.
    const bits = Math.ceil(Math.log2(grid.length || 1));
    const rev = (i: number) => parseInt(i.toString(2).padStart(bits, "0").split("").reverse().join(""), 2);
    this.prefetch = grid.map((g, i) => ({ g, k: rev(i) })).sort((a, b) => a.k - b.k).map((x) => x.g);
    this.pump();
  }

  // Two frames load at a time: the wanted one first, prefetching otherwise.
  private pump() {
    while (!this.broken && this.loading.size < 2) {
      let next: number | undefined;
      if (this.wanted !== null && !this.frames.has(this.wanted) && !this.loading.has(this.wanted)) {
        next = this.wanted;
        this.wanted = null;
      } else {
        while (this.prefetch.length && next === undefined) {
          const i = this.prefetch.shift()!;
          if (!this.frames.has(i) && !this.loading.has(i)) next = i;
        }
      }
      if (next === undefined) return;
      const index = next;
      this.loading.add(index);
      this.load(index).finally(() => {
        this.loading.delete(index);
        this.listeners.forEach((l) => l());
        this.pump();
      });
    }
  }

  private async load(index: number): Promise<string | null> {
    const hit = this.frames.get(index);
    if (hit) return hit;
    const k = this.list[index];
    try {
      const res = await fetch(k.url, { headers: { Range: `bytes=${k.offset}-${k.offset + k.length - 1}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (res.status === 200) bytes = bytes.subarray(k.offset, k.offset + k.length); // range ignored
      const h264 = h264FromTs(bytes);
      if (!h264) throw new Error("no video");
      const url = await toImage(await decode(h264));
      if (this.broken) {
        URL.revokeObjectURL(url);
        return null;
      }
      this.frames.set(index, url);
      this.failures = 0;
      return url;
    } catch {
      // A few failures in a row (codec unsupported, CDN refusing ranges): fall back to the time only.
      if (++this.failures >= 3 && !this.frames.size) this.broken = true;
      return null;
    }
  }

  dispose() {
    this.broken = true;
    this.wanted = null;
    this.prefetch = [];
    this.listeners.clear();
    for (const url of this.frames.values()) URL.revokeObjectURL(url);
    this.frames.clear();
  }
}

const supported = typeof VideoDecoder !== "undefined" && typeof EncodedVideoChunk !== "undefined";

/**
 * Preview image for `time` in the stream `src` (null while nothing is being previewed): the frame
 * nearest `time` among those loaded so far. The keyframe index loads with the episode; frames load
 * from the first time the bar is used (where the pointer is first, a grid across the episode behind).
 * `available` is false when this stream or device can't make previews.
 */
export function usePreview(src: string | null, time: number | null): { image: string | null; available: boolean } {
  const [trickplay, setTrickplay] = useState<{ src: string; tp: Trickplay | null } | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [, setVersion] = useState(0);
  const indexRef = useRef(-1);

  // The keyframe index (two small playlists) loads with the episode, so the first hover is quick.
  useEffect(() => {
    if (!supported || !src) return;
    let live = true;
    let made: Trickplay | null = null;
    keyframes(src)
      .catch(() => null)
      .then((list) => {
        made = list && new Trickplay(list);
        if (live) setTrickplay({ src, tp: made });
        else made?.dispose();
      });
    return () => {
      live = false;
      made?.dispose();
      setTrickplay(null);
      setImage(null);
    };
  }, [src]);

  const tp = trickplay && trickplay.src === src ? trickplay.tp : null;
  const index = tp && time !== null ? tp.indexAt(time) : -1;
  indexRef.current = index;

  // Every arriving frame may be closer to where the viewer is now than the one shown.
  useEffect(() => {
    if (!tp) return;
    return tp.subscribe(() => {
      setVersion((v) => v + 1);
      if (indexRef.current >= 0) {
        const hit = tp.nearest(indexRef.current);
        if (hit) setImage(hit);
      }
    });
  }, [tp]);

  // The grid of frames loads a few seconds into the episode (~1.5 MB), so the first drag already
  // has previews all along the bar.
  useEffect(() => {
    if (!tp) return;
    const t = window.setTimeout(() => tp.startPrefetch(), 4000);
    return () => window.clearTimeout(t);
  }, [tp]);

  useEffect(() => {
    if (!tp || index < 0) return;
    tp.startPrefetch(); // the bar is used before the grid started: start it now
    const hit = tp.nearest(index);
    if (hit) setImage(hit);
    tp.want(index);
  }, [tp, index]);

  const pending = supported && !!src && trickplay === null;
  return { image: tp && !tp.broken ? image : null, available: tp ? !tp.broken : pending };
}
