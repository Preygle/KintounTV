package app.kintountv.player;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Serves the in-app origin: bundled site files, the AniLab catalog API proxy (/api), the KYOTO
 * Player streaming lookups (/stream), the HLS relay (/hls) and downloads (/downloads, see
 * {@link Downloads}). Android counterpart of the desktop exe's Go server (desktop/api.go,
 * desktop/stream.go, desktop/downloads.go) — keep the behaviour in sync.
 */
final class LocalServer implements Downloads.Resolver {
    private static final String UPSTREAM = "https://anilab2.amdapi.click/api/";
    private static final Set<String> ENDPOINTS = new HashSet<>(Arrays.asList("home", "config", "categories", "category", "latest", "post", "search", "list"));
    private static final String KYOTO = "https://app.kyotoplayer.com/api/v4/";
    private static final String KYOTO_UA = "okhttp/4.12.0";
    static final String BROWSER_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
    static final Pattern ID = Pattern.compile("^[A-Za-z0-9_./-]{1,64}$");
    private static final Pattern URI_ATTR = Pattern.compile("URI=\"([^\"]+)\"");
    private static final long API_TTL = 3 * 60_000, CONFIG_TTL = 10 * 60_000, EPISODES_TTL = 5 * 60_000;

    private final AssetManager assets;
    private final Downloads downloads;
    private final Map<String, Cached> cache = new LinkedHashMap<String, Cached>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Cached> eldest) {
            return size() > 256;
        }
    };

    private static final class Cached {
        final long at;
        final byte[] body;
        final String type;

        Cached(byte[] body, String type) {
            this.at = System.currentTimeMillis();
            this.body = body;
            this.type = type;
        }
    }

    LocalServer(AssetManager assets, Downloads downloads) {
        this.assets = assets;
        this.downloads = downloads;
        downloads.setResolver(this);
    }

    WebResourceResponse handle(String method, Uri url, Map<String, String> headers) {
        String path = url.getPath() == null ? "/" : url.getPath();
        try {
            if (path.startsWith("/api/")) return api(method, path.substring(5), url);
            if (path.startsWith("/stream/")) return stream(path, url);
            if (path.equals("/hls")) return hls(url.getQueryParameter("u"), headers);
            if (path.startsWith("/downloads/")) return downloads.handle(path, url, headers);
            if (path.equals("/skips/introdb")) return introDB(url);
            return asset(path);
        } catch (HttpError e) {
            return json(e.status, error(e.getMessage()));
        } catch (Exception e) {
            return json(502, error(e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    // ---- bundled site ---------------------------------------------------------------------------

    private WebResourceResponse asset(String path) throws IOException {
        String name = path.equals("/") ? "index.html" : path.substring(1);
        if (name.contains("..")) name = "index.html";
        InputStream in;
        try {
            in = assets.open("web/" + name);
        } catch (IOException notFound) {
            name = "index.html"; // SPA route
            in = assets.open("web/index.html");
        }
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", name.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache");
        return new WebResourceResponse(mime(name), name.endsWith(".html") || name.endsWith(".js") || name.endsWith(".css") ? "utf-8" : null, 200, "OK", h, in);
    }

    private static String mime(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".json") || n.endsWith(".webmanifest")) return "application/json";
        return "application/octet-stream";
    }

    // ---- catalog API ----------------------------------------------------------------------------

    private WebResourceResponse api(String method, String endpoint, Uri url) throws Exception {
        if (!ENDPOINTS.contains(endpoint) || !"GET".equals(method)) throw new HttpError(404, "not found");
        String query = url.getEncodedQuery();
        String target = UPSTREAM + endpoint + (query == null ? "" : "?" + query);
        byte[] body = null;
        String upstreamMethod = "GET";
        if (endpoint.equals("list")) {
            // My List arrives as GET list?page=N&ids=1,2,3 (POST bodies of intercepted requests are not
            // visible to the app); the upstream wants POST list?page=N with {"ids":[...]}.
            JSONArray ids = new JSONArray();
            String raw = url.getQueryParameter("ids");
            if (raw != null) for (String s : raw.split(",")) {
                try {
                    int n = Integer.parseInt(s.trim());
                    if (n > 0) ids.put(n);
                } catch (NumberFormatException ignored) {
                }
            }
            String page = url.getQueryParameter("page");
            target = UPSTREAM + "list?page=" + Uri.encode(page == null ? "1" : page);
            body = new JSONObject().put("ids", ids).toString().getBytes(StandardCharsets.UTF_8);
            upstreamMethod = "POST";
        } else {
            Cached c;
            synchronized (cache) {
                c = cache.get(target);
            }
            if (c != null && System.currentTimeMillis() - c.at < API_TTL) return bytes(200, c.type, c.body);
        }
        Map<String, String> h = new HashMap<>();
        h.put("Accept", "application/json");
        h.put("Content-Type", "application/json");
        h.put("os-version", String.valueOf(android.os.Build.VERSION.SDK_INT));
        h.put("app-id", "com.xo.anilab");
        h.put("app-version", "105");
        h.put("os-id", "");
        HttpURLConnection c = Net.open(upstreamMethod, target, h, body);
        try {
            byte[] data = Net.readAll(c);
            int status = c.getResponseCode();
            String type = c.getContentType() == null ? "application/json" : c.getContentType();
            if (status == 200 && body == null) {
                synchronized (cache) {
                    cache.put(target, new Cached(data, type));
                }
            }
            return bytes(status, type, data);
        } finally {
            c.disconnect();
        }
    }

    // ---- streaming (KYOTO Player's lookup chain; see desktop/stream.go) -----------------------

    private WebResourceResponse stream(String path, Uri url) throws Exception {
        JSONObject config = config(url.getQueryParameter("id"));
        switch (path) {
            case "/stream/episodes": {
                String postId = url.getQueryParameter("id");
                Cached c;
                synchronized (cache) {
                    c = cache.get("episodes:" + postId);
                }
                if (c != null && System.currentTimeMillis() - c.at < EPISODES_TTL) return bytes(200, "application/json", c.body);
                byte[] data = getBytes(config.getString("episodes"), kyotoHeaders(), "could not load episodes");
                new JSONObject(new String(data, StandardCharsets.UTF_8)); // validate
                synchronized (cache) {
                    cache.put("episodes:" + postId, new Cached(data, "application/json"));
                }
                return bytes(200, "application/json", data);
            }
            case "/stream/servers":
                return bytes(200, "application/json", servers(url.getQueryParameter("id"), url.getQueryParameter("episode")).getBytes(StandardCharsets.UTF_8));
            case "/stream/source":
                return json(200, new JSONObject().put("url", relayPath(link(url.getQueryParameter("id"), url.getQueryParameter("server")))).toString());
            default:
                throw new HttpError(404, "not found");
        }
    }

    @Override
    public String servers(String postId, String episodeId) throws Exception {
        JSONObject config = config(postId);
        String ep = checkId(episodeId, "episode");
        byte[] data = getBytes(config.getString("servers").replace("%id%", ep), kyotoHeaders(), "could not load servers");
        String body = new String(data, StandardCharsets.UTF_8);
        new JSONObject(body); // validate
        return body;
    }

    /** The HLS master playlist (on the video CDN) behind a server. */
    @Override
    public String link(String postId, String serverId) throws Exception {
        JSONObject config = config(postId);
        String server = checkId(serverId, "server");
        JSONObject req = config.getJSONObject("server");
        Map<String, String> h = kyotoHeaders();
        JSONArray pairs = req.optJSONArray("headers");
        if (pairs != null) for (int i = 0; i < pairs.length(); i++) {
            JSONArray p = pairs.optJSONArray(i);
            if (p != null && p.length() == 2) h.put(p.getString(0), p.getString(1));
        }
        byte[] data = getBytes(req.getString("url").replace("%id%", server), h, "could not load the video source");
        String link = new JSONObject(new String(data, StandardCharsets.UTF_8)).optString("link", "");
        if (!link.startsWith("https://")) throw new HttpError(502, "this server has no video right now — try another one");
        return link;
    }

    private JSONObject config(String postId) throws Exception {
        checkId(postId, "id");
        String key = "config:" + postId;
        Cached c;
        synchronized (cache) {
            c = cache.get(key);
        }
        if (c != null && System.currentTimeMillis() - c.at < CONFIG_TTL) return new JSONObject(new String(c.body, StandardCharsets.UTF_8));
        byte[] data = getBytes(KYOTO + "post?id=" + Uri.encode(postId), kyotoHeaders(), "streaming service unreachable");
        JSONObject json = new JSONObject(new String(data, StandardCharsets.UTF_8));
        if (json.optString("episodes").isEmpty() || json.optString("servers").isEmpty() || json.optJSONObject("server") == null) {
            throw new HttpError(502, "no streams available for this title");
        }
        synchronized (cache) {
            cache.put(key, new Cached(data, "application/json"));
        }
        return json;
    }

    private static Map<String, String> kyotoHeaders() {
        Map<String, String> h = new HashMap<>();
        h.put("User-Agent", KYOTO_UA);
        h.put("Accept", "application/json");
        return h;
    }

    private static String checkId(String value, String field) throws HttpError {
        if (value == null || !ID.matcher(value).matches()) throw new HttpError(400, "invalid " + field);
        return value;
    }

    private static byte[] getBytes(String url, Map<String, String> headers, String what) throws Exception {
        HttpURLConnection c;
        try {
            c = Net.open("GET", url, headers, null);
        } catch (IOException e) {
            throw new HttpError(502, what + ": " + e.getMessage());
        }
        try {
            if (c.getResponseCode() != 200) throw new HttpError(502, what + ": HTTP " + c.getResponseCode());
            return Net.readAll(c);
        } finally {
            c.disconnect();
        }
    }

    // ---- skip times ---------------------------------------------------------------------------------

    /** IntroDB skip times (src/skips.ts): its API only allows its own site cross-origin. */
    private WebResourceResponse introDB(Uri url) throws Exception {
        String target = "https://api.introdb.app/segments?imdb_id=" + Uri.encode(nonNull(url.getQueryParameter("imdb_id")))
                + "&season=" + Uri.encode(nonNull(url.getQueryParameter("season")))
                + "&episode=" + Uri.encode(nonNull(url.getQueryParameter("episode")));
        Map<String, String> h = new HashMap<>();
        h.put("Accept", "application/json");
        HttpURLConnection c = Net.open("GET", target, h, null);
        try {
            byte[] data = Net.readAll(c);
            return bytes(c.getResponseCode() == 200 ? 200 : 404, "application/json", data);
        } finally {
            c.disconnect();
        }
    }

    private static String nonNull(String s) {
        return s == null ? "" : s;
    }

    // ---- HLS relay ------------------------------------------------------------------------------

    private static String relayPath(String target) {
        return "/hls?u=" + Uri.encode(target);
    }

    private WebResourceResponse hls(String target, Map<String, String> requestHeaders) throws Exception {
        if (target == null || !target.startsWith("https://")) throw new HttpError(400, "bad url");
        Map<String, String> h = new HashMap<>();
        h.put("User-Agent", BROWSER_UA);
        String range = requestHeaders == null ? null : requestHeaders.get("Range");
        if (range != null) h.put("Range", range);
        HttpURLConnection c = Net.open("GET", target, h, null);
        String type = c.getContentType() == null ? "" : c.getContentType().toLowerCase(Locale.ROOT);
        String lowerPath = new URL(target).getPath().toLowerCase(Locale.ROOT);
        boolean playlist = lowerPath.endsWith(".m3u8") || type.contains("mpegurl");
        int status = c.getResponseCode();
        if (!playlist) {
            // Segments arrive disguised (".xls", application/vnd.ms-excel) but are plain MPEG-TS.
            // The stream is handed to the WebView and read lazily, so playback starts immediately.
            Map<String, String> out = new HashMap<>();
            if (c.getHeaderField("Content-Length") != null) out.put("Content-Length", c.getHeaderField("Content-Length"));
            if (c.getHeaderField("Content-Range") != null) out.put("Content-Range", c.getHeaderField("Content-Range"));
            InputStream body = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (body == null) body = new ByteArrayInputStream(new byte[0]);
            return new WebResourceResponse(type.startsWith("video/") ? type : "video/mp2t", null, status, reason(status), out, body);
        }
        try {
            if (status != 200) throw new HttpError(502, "playlist unavailable");
            URL base = new URL(target);
            StringBuilder sb = new StringBuilder();
            for (String line : Net.readString(c).split("\n", -1)) {
                String l = line.endsWith("\r") ? line.substring(0, line.length() - 1) : line;
                if (l.isEmpty()) {
                    sb.append('\n');
                    continue;
                }
                if (l.startsWith("#")) {
                    Matcher m = URI_ATTR.matcher(l);
                    StringBuffer rewritten = new StringBuffer();
                    while (m.find()) {
                        m.appendReplacement(rewritten, Matcher.quoteReplacement("URI=\"" + relayPath(new URL(base, m.group(1)).toString()) + "\""));
                    }
                    m.appendTail(rewritten);
                    sb.append(rewritten).append('\n');
                } else {
                    sb.append(relayPath(new URL(base, l.trim()).toString())).append('\n');
                }
            }
            Map<String, String> out = new HashMap<>();
            out.put("Cache-Control", "no-store");
            return new WebResourceResponse("application/vnd.apple.mpegurl", "utf-8", 200, "OK", out,
                    new ByteArrayInputStream(sb.toString().getBytes(StandardCharsets.UTF_8)));
        } finally {
            c.disconnect();
        }
    }

    // ---- responses --------------------------------------------------------------------------------

    private static final class HttpError extends Exception {
        final int status;

        HttpError(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    static String error(String message) {
        try {
            return new JSONObject().put("error", message).toString();
        } catch (Exception e) {
            return "{\"error\":\"error\"}";
        }
    }

    static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            default: return status >= 500 ? "Bad Gateway" : "Status";
        }
    }

    static WebResourceResponse bytes(int status, String type, byte[] body) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        String mime = type.contains(";") ? type.substring(0, type.indexOf(';')).trim() : type;
        return new WebResourceResponse(mime, "utf-8", status, reason(status), h, new ByteArrayInputStream(body));
    }

    static WebResourceResponse json(int status, String body) {
        return bytes(status, "application/json", body.getBytes(StandardCharsets.UTF_8));
    }
}
