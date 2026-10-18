// Streaming endpoints for the Node servers (server.mjs and the Vite dev server).
// Same behaviour as desktop/stream.go: KYOTO Player's lookup chain under /stream/*, plus an HLS
// relay at /hls that rewrites playlist URIs (the video CDN sends no CORS headers).
import { UPSTREAM_BASE, UPSTREAM_HEADERS, listAsPost } from "./upstream.mjs";

const KYOTO_BASE = "https://app.kyotoplayer.com/api/v4/";
const KYOTO_UA = "okhttp/4.12.0";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ID = /^[A-Za-z0-9_./-]{1,64}$/;

const configs = new Map(); // postId -> { at, value }
const CONFIG_TTL = 10 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Retry once on a network error (not on HTTP error statuses): flaky links often fail the first connect.
async function fetchRetry(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    return fetch(url, init);
  }
}

async function getJson(url, headers = {}) {
  const res = await fetchRetry(url, { headers: { "User-Agent": KYOTO_UA, Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function config(postId) {
  if (!ID.test(postId ?? "")) throw new HttpError(400, "invalid id");
  const hit = configs.get(postId);
  if (hit && Date.now() - hit.at < CONFIG_TTL) return hit.value;
  let value;
  try {
    value = await getJson(`${KYOTO_BASE}post?id=${encodeURIComponent(postId)}`);
  } catch (err) {
    throw new Error(`streaming service unreachable: ${err.message}`);
  }
  if (!value?.episodes || !value?.servers || !value?.server?.url) throw new Error("no streams available for this title");
  configs.set(postId, { at: Date.now(), value });
  return value;
}

const relayPath = (url) => `/hls?u=${encodeURIComponent(url)}`;

async function watch(path, q) {
  const c = await config(q.get("id"));
  if (path === "/stream/episodes") return getJson(c.episodes);
  if (path === "/stream/servers") {
    const ep = q.get("episode");
    if (!ID.test(ep ?? "")) throw new HttpError(400, "invalid episode");
    return getJson(c.servers.replaceAll("%id%", ep));
  }
  if (path === "/stream/source") {
    const server = q.get("server");
    if (!ID.test(server ?? "")) throw new HttpError(400, "invalid server");
    const headers = Object.fromEntries((c.server.headers ?? []).filter((h) => h.length === 2));
    const { link } = await getJson(c.server.url.replaceAll("%id%", server), headers);
    if (!link || !link.startsWith("https://")) throw new Error("this server has no video right now — try another one");
    return { url: relayPath(link) };
  }
  throw new HttpError(404, "not found");
}

async function relay(req, res, target) {
  let url;
  try {
    url = new URL(target ?? "");
    if (url.protocol !== "https:") throw new Error();
  } catch {
    res.writeHead(400).end("bad url");
    return;
  }
  const headers = { "User-Agent": BROWSER_UA };
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = await fetchRetry(url, { headers });
  const type = upstream.headers.get("content-type") ?? "";
  const isPlaylist = url.pathname.toLowerCase().endsWith(".m3u8") || type.toLowerCase().includes("mpegurl");
  if (!isPlaylist) {
    const out = { "Content-Type": type.startsWith("video/") ? type : "video/mp2t", "Cache-Control": "private, max-age=3600" };
    for (const h of ["content-length", "content-range", "accept-ranges"]) if (upstream.headers.get(h)) out[h] = upstream.headers.get(h);
    res.writeHead(upstream.status, out);
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
    return;
  }
  if (!upstream.ok) {
    res.writeHead(502).end("playlist unavailable");
    return;
  }
  const resolve = (ref) => relayPath(new URL(ref.trim(), url).href);
  const text = (await upstream.text())
    .split("\n")
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, ref) => `URI="${resolve(ref)}"`);
      return resolve(line);
    })
    .join("\n");
  res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
  res.end(text);
}

// Returns true when the request was handled.
export async function handleStream(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/hls" && !url.pathname.startsWith("/stream/")) return false;
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") {
    res.writeHead(403).end("forbidden");
    return true;
  }
  try {
    if (url.pathname === "/hls") await relay(req, res, url.searchParams.get("u"));
    else {
      const body = JSON.stringify(await watch(url.pathname, url.searchParams));
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(body);
    }
  } catch (err) {
    if (!res.headersSent) res.writeHead(err.status ?? 502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// Dev server only: GET /api/list?ids= is converted to the upstream POST (server.mjs does this in its proxy).
export async function handleApiList(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/api/list" || req.method !== "GET") return false;
  const { search, body } = listAsPost(url.searchParams);
  const upstream = await fetch(UPSTREAM_BASE + "list" + search, { method: "POST", headers: UPSTREAM_HEADERS, body });
  res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
  res.end(Buffer.from(await upstream.arrayBuffer()));
  return true;
}
