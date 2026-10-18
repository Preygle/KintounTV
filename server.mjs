// Production server: serves the built SPA from dist/ and proxies /api/* to the upstream API.
// The upstream only allows cross-origin GET, so POST /api/list (My List) needs this proxy.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UPSTREAM_BASE, UPSTREAM_HEADERS, ALLOWED_ENDPOINTS, listAsPost } from "./upstream.mjs";
import { handleStream } from "./stream.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

async function proxy(req, res, url) {
  const endpoint = url.pathname.slice("/api/".length);
  if (!ALLOWED_ENDPOINTS.has(endpoint) || !["GET", "POST"].includes(req.method)) {
    res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
    return;
  }
  let body;
  let method = req.method;
  let search = url.search;
  if (endpoint === "list" && req.method === "GET") {
    ({ search, body } = listAsPost(url.searchParams));
    method = "POST";
  } else if (req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
    if (body.length > 64 * 1024) {
      res.writeHead(413).end();
      return;
    }
  }
  try {
    const upstream = await fetch(UPSTREAM_BASE + endpoint + search, {
      method,
      headers: UPSTREAM_HEADERS,
      body,
    });
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": method === "GET" ? "public, max-age=60" : "no-store",
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(err) }));
  }
}

function serveStatic(res, url) {
  const requested = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  const file =
    requested.startsWith(root) && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(root, "index.html");
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) proxy(req, res, url);
    else if (!(await handleStream(req, res))) serveStatic(res, url);
  })
  .listen(port, () => console.log(`KintounTV on http://localhost:${port}`));
