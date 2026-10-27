package app.kintountv.player;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Episodes saved for offline viewing. Android counterpart of desktop/downloads.go — same folder
 * layout (video.ts + parts.json + index.m3u8 per episode), same /downloads endpoints, same JSON.
 * Files live in the app's own storage (Android/data/app.kintountv.player/files/downloads) and are
 * removed with the app. {@link DownloadService} keeps the process alive while something downloads.
 */
final class Downloads {
    interface Resolver {
        String servers(String postId, String episodeId) throws Exception;

        String link(String postId, String serverId) throws Exception;
    }

    private static final int WORKERS = 4;
    private static final int TRIES = 3;
    private static final int MAX_SEGMENT = 64 << 20;
    private static final Pattern SAFE = Pattern.compile("[^A-Za-z0-9_-]+");
    private static final Pattern RESOLUTION = Pattern.compile("RESOLUTION=\\d+x(\\d+)");
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    static final class Job {
        String id, postId, title = "", poster = "", episodeId, number = "", name = "", lang, status = "queued", error;
        int quality, height, segments, done;
        long bytes, added;
        double duration;
        boolean deleted;
        final List<long[]> parts = new ArrayList<>(); // {offset, length}
        final List<Double> durations = new ArrayList<>();

        JSONObject toJson() throws Exception {
            JSONObject o = new JSONObject()
                    .put("id", id).put("postId", postId).put("title", title).put("poster", poster)
                    .put("episodeId", episodeId).put("number", number).put("name", name).put("lang", lang)
                    .put("quality", quality).put("height", height).put("status", status)
                    .put("segments", segments).put("done", done).put("bytes", bytes).put("duration", duration).put("added", added);
            if (error != null) o.put("error", error);
            return o;
        }

        static Job fromJson(JSONObject o) {
            Job j = new Job();
            j.id = o.optString("id");
            j.postId = o.optString("postId");
            j.title = o.optString("title");
            j.poster = o.optString("poster");
            j.episodeId = o.optString("episodeId");
            j.number = o.optString("number");
            j.name = o.optString("name");
            j.lang = o.optString("lang");
            j.status = o.optString("status", "queued");
            j.error = o.has("error") ? o.optString("error") : null;
            j.quality = o.optInt("quality", 720);
            j.height = o.optInt("height");
            j.segments = o.optInt("segments");
            j.done = o.optInt("done");
            j.bytes = o.optLong("bytes");
            j.duration = o.optDouble("duration", 0);
            j.added = o.optLong("added");
            return j;
        }
    }

    private static final class Segment {
        final String url;
        final double duration;

        Segment(String url, double duration) {
            this.url = url;
            this.duration = duration;
        }
    }

    private static final class Rendition {
        final List<Segment> segments;
        final int height;

        Rendition(List<Segment> segments, int height) {
            this.segments = segments;
            this.height = height;
        }
    }

    private static Downloads instance;

    static synchronized Downloads get(Context context) {
        if (instance == null) instance = new Downloads(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private final File dir;
    private final Map<String, Job> jobs = new LinkedHashMap<>();
    private final ExecutorService fetchers = Executors.newFixedThreadPool(WORKERS);
    private volatile Resolver resolver;
    private Job current;
    private volatile boolean stopCurrent;
    private Thread worker;
    private long savedAt;
    /** Called on the first download, so the activity can ask for permission to show progress. */
    volatile Runnable onFirstAdd;

    private Downloads(Context context) {
        this.context = context;
        File base = context.getExternalFilesDir(null);
        dir = new File(base != null ? base : context.getFilesDir(), "downloads");
        load();
    }

    void setResolver(Resolver r) {
        resolver = r;
        synchronized (this) {
            if (hasQueued()) startWorker();
        }
    }

    // ---- state ------------------------------------------------------------------------------------

    private static String safeId(String s) {
        return SAFE.matcher(s).replaceAll("_");
    }

    private void load() {
        try {
            JSONArray list = new JSONArray(readText(new File(dir, "downloads.json")));
            for (int i = 0; i < list.length(); i++) {
                Job j = Job.fromJson(list.getJSONObject(i));
                if (j.id.isEmpty() || !j.id.equals(safeId(j.id))) continue;
                if (j.status.equals("done") && !new File(new File(dir, j.id), "index.m3u8").exists()) continue;
                if (j.status.equals("downloading")) j.status = "queued";
                jobs.put(j.id, j);
            }
        } catch (Exception ignored) {
            // no list yet
        }
    }

    private void saveLocked() {
        try {
            JSONArray list = new JSONArray();
            for (Job j : jobs.values()) list.put(j.toJson());
            dir.mkdirs();
            File tmp = new File(dir, "downloads.json.tmp");
            writeText(tmp, list.toString());
            if (!tmp.renameTo(new File(dir, "downloads.json"))) {
                writeText(new File(dir, "downloads.json"), list.toString());
            }
        } catch (Exception ignored) {
            // the list is rewritten on the next change
        }
        savedAt = System.currentTimeMillis();
    }

    synchronized boolean busy() {
        return current != null || hasQueued();
    }

    private boolean hasQueued() {
        for (Job j : jobs.values()) if (j.status.equals("queued")) return true;
        return false;
    }

    /** One line for the notification. */
    synchronized String describe() {
        Job j = current;
        if (j == null) return "Waiting…";
        int pct = j.segments > 0 ? 100 * j.done / j.segments : 0;
        int left = 0;
        for (Job o : jobs.values()) if (o.status.equals("queued")) left++;
        return j.title + " · Episode " + j.number + " · " + pct + "%" + (left > 0 ? " · " + left + " more" : "");
    }

    private synchronized JSONObject snapshot() throws Exception {
        JSONArray items = new JSONArray();
        for (Job j : jobs.values()) items.put(j.toJson());
        return new JSONObject().put("items", items).put("dir", dir.getAbsolutePath());
    }

    private synchronized void add(String postId, String title, String poster, String lang, int quality, JSONArray eps) {
        boolean first = jobs.isEmpty();
        for (int i = 0; i < eps.length(); i++) {
            JSONObject ep = eps.optJSONObject(i);
            if (ep == null || !LocalServer.ID.matcher(ep.optString("id")).matches()) continue;
            String id = safeId(postId + "-" + ep.optString("id") + "-" + lang);
            Job existing = jobs.get(id);
            if (existing != null) {
                if (existing.status.equals("paused") || existing.status.equals("error")) {
                    existing.status = "queued";
                    existing.error = null;
                }
                continue;
            }
            Job j = new Job();
            j.id = id;
            j.postId = postId;
            j.title = title;
            j.poster = poster;
            j.episodeId = ep.optString("id");
            j.number = ep.optString("number");
            j.name = ep.optString("name");
            j.lang = lang;
            j.quality = quality;
            j.added = System.currentTimeMillis();
            jobs.put(id, j);
        }
        saveLocked();
        startWorker();
        Runnable hook = onFirstAdd;
        if (first && hook != null) hook.run();
    }

    private synchronized void act(String action, List<String> ids) {
        for (String id : ids) {
            Job j = jobs.get(id);
            if (j == null) continue;
            switch (action) {
                case "pause":
                    if (j.status.equals("queued") || j.status.equals("downloading")) {
                        j.status = "paused";
                        if (j == current) stopCurrent = true;
                    }
                    break;
                case "resume":
                    if (j.status.equals("paused") || j.status.equals("error")) {
                        j.status = "queued";
                        j.error = null;
                    }
                    break;
                case "delete":
                    j.deleted = true;
                    jobs.remove(id);
                    if (j == current) stopCurrent = true; // the worker removes the folder
                    else deleteDir(new File(dir, id));
                    break;
            }
        }
        saveLocked();
        startWorker();
    }

    // ---- worker -----------------------------------------------------------------------------------

    private void startWorker() {
        if (resolver == null || !hasQueued()) return;
        if (worker == null || !worker.isAlive()) {
            worker = new Thread(new Runnable() {
                @Override
                public void run() {
                    work();
                }
            }, "downloads");
            worker.start();
        }
        Intent service = new Intent(context, DownloadService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
            else context.startService(service);
        } catch (Exception ignored) {
            // not allowed from the background: downloads still run while the app is open
        }
    }

    private void work() {
        while (true) {
            Job j;
            synchronized (this) {
                j = null;
                for (Job o : jobs.values()) {
                    if (o.status.equals("queued")) {
                        j = o;
                        break;
                    }
                }
                if (j == null) {
                    worker = null;
                    return;
                }
                current = j;
                stopCurrent = false;
                j.status = "downloading";
                saveLocked();
            }
            String error = null;
            try {
                run(j);
            } catch (Exception e) {
                error = e.getMessage() == null ? e.toString() : e.getMessage();
            }
            synchronized (this) {
                current = null;
                if (j.deleted) deleteDir(new File(dir, j.id));
                else if (stopCurrent) {
                    // paused
                } else if (error == null) {
                    j.status = "done";
                    j.error = null;
                    j.parts.clear();
                    j.durations.clear();
                } else {
                    j.status = "error";
                    j.error = error;
                }
                saveLocked();
            }
        }
    }

    private static final class Stopped extends Exception {
    }

    private void run(Job j) throws Exception {
        File jobDir = new File(dir, j.id);
        if (!jobDir.mkdirs() && !jobDir.isDirectory()) throw new IOException("could not create the download folder");
        Rendition r = resolve(j, 0);

        List<long[]> parts = new ArrayList<>();
        List<Double> durations = new ArrayList<>();
        readParts(jobDir, parts, durations);
        if (j.segments != r.segments.size() || j.height != r.height || parts.size() > r.segments.size()) {
            parts.clear();
            durations.clear();
        }
        long size = parts.isEmpty() ? 0 : parts.get(parts.size() - 1)[0] + parts.get(parts.size() - 1)[1];
        try (RandomAccessFile f = new RandomAccessFile(new File(jobDir, "video.ts"), "rw")) {
            f.setLength(size);
            f.seek(size);
            synchronized (this) {
                j.segments = r.segments.size();
                j.height = r.height;
                j.parts.clear();
                j.parts.addAll(parts);
                j.durations.clear();
                j.durations.addAll(durations);
                j.done = parts.size();
                j.bytes = size;
                j.duration = 0;
                for (double d : durations) j.duration += d;
            }
            // A sliding window: WORKERS requests in flight, written to the file in order as they land.
            // (Net's 20 s read timeout gives up on a stalled transfer; the retry usually flows.)
            List<Segment> segs = r.segments;
            boolean refreshed = false;
            ArrayDeque<Future<byte[]>> window = new ArrayDeque<>();
            int next = parts.size(), launch = next;
            try {
                while (next < segs.size()) {
                    for (; launch < segs.size() && launch - next < WORKERS; launch++) {
                        final String url = segs.get(launch).url;
                        window.add(fetchers.submit(new Callable<byte[]>() {
                            @Override
                            public byte[] call() throws Exception {
                                return fetchSegment(url);
                            }
                        }));
                    }
                    Future<byte[]> head = window.peek();
                    byte[] body = null;
                    Exception failure = null;
                    while (body == null && failure == null) {
                        if (stopCurrent) throw new Stopped();
                        try {
                            body = head.get(1, TimeUnit.SECONDS);
                        } catch (TimeoutException waiting) {
                            // check for pause/delete, then keep waiting
                        } catch (ExecutionException e) {
                            failure = e.getCause() instanceof Exception ? (Exception) e.getCause() : e;
                        }
                    }
                    window.poll();
                    if (failure != null) {
                        if (stopCurrent) throw new Stopped();
                        // The CDN link may have expired: look it up again once, then give up.
                        if (refreshed) {
                            throw new IOException("episode " + j.number + " stopped at " + (100 * next / segs.size()) + "%: " + failure.getMessage());
                        }
                        Rendition fresh;
                        try {
                            fresh = resolve(j, r.height);
                        } catch (Exception e) {
                            fresh = null;
                        }
                        if (fresh == null || fresh.segments.size() != segs.size()) throw new IOException("the video link expired and could not be renewed");
                        segs = fresh.segments;
                        refreshed = true;
                        for (Future<byte[]> fu : window) fu.cancel(true);
                        window.clear();
                        launch = next;
                        continue;
                    }
                    double duration = segs.get(next).duration;
                    f.write(body);
                    long[] p = {size, body.length};
                    size += body.length;
                    next++;
                    synchronized (this) {
                        j.parts.add(p);
                        j.durations.add(duration);
                        j.done = j.parts.size();
                        j.bytes = size;
                        j.duration += duration;
                        if (System.currentTimeMillis() - savedAt > 5000) {
                            writeParts(jobDir, j.parts, j.durations);
                            saveLocked();
                        }
                    }
                }
            } finally {
                for (Future<byte[]> fu : window) fu.cancel(true);
            }
        } catch (Stopped stopped) {
            synchronized (this) {
                if (!j.deleted) writeParts(jobDir, j.parts, j.durations);
            }
            return;
        }
        synchronized (this) {
            writeParts(jobDir, j.parts, j.durations);
            writePlaylist(jobDir, j.parts, j.durations);
        }
    }

    /** A server in the wanted language, its rendition at or below the wanted height (or exactly `height`). */
    private Rendition resolve(Job j, int height) throws Exception {
        Resolver res = resolver;
        JSONArray list = new JSONObject(res.servers(j.postId, j.episodeId)).optJSONArray("list");
        Exception last = new IOException("no " + j.lang.toUpperCase(Locale.ROOT) + " servers for episode " + j.number);
        Set<String> tried = new HashSet<>();
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject s = list.optJSONObject(i);
            if (s == null || !j.lang.equals(s.optString("lang")) || !tried.add(s.optString("id"))) continue;
            try {
                return pickRendition(res.link(j.postId, s.optString("id")), j.quality, height);
            } catch (Exception e) {
                last = e;
            }
        }
        throw last;
    }

    private static Rendition pickRendition(String master, int quality, int exact) throws Exception {
        URL base = new URL(master);
        List<String> lines = fetchPlaylist(master);
        List<String> uris = new ArrayList<>();
        final List<Integer> heights = new ArrayList<>();
        for (int i = 0; i + 1 < lines.size(); i++) {
            String l = lines.get(i);
            if (!l.startsWith("#EXT-X-STREAM-INF:")) continue;
            Matcher m = RESOLUTION.matcher(l);
            heights.add(m.find() ? Integer.parseInt(m.group(1)) : 0);
            uris.add(new URL(base, lines.get(i + 1)).toString());
        }
        if (uris.isEmpty()) return new Rendition(parseMedia(base, lines), 0);
        Integer[] order = new Integer[uris.size()];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, new Comparator<Integer>() {
            @Override
            public int compare(Integer a, Integer b) {
                return heights.get(b) - heights.get(a);
            }
        });
        int pick = order[order.length - 1];
        for (int i : order) {
            int h = heights.get(i);
            if ((exact > 0 && h == exact) || (exact == 0 && h <= quality)) {
                pick = i;
                break;
            }
        }
        String media = uris.get(pick);
        return new Rendition(parseMedia(new URL(media), fetchPlaylist(media)), heights.get(pick));
    }

    private static List<Segment> parseMedia(URL base, List<String> lines) throws Exception {
        List<Segment> segs = new ArrayList<>();
        double dur = 0;
        for (String l : lines) {
            if ((l.startsWith("#EXT-X-KEY:") && !l.contains("METHOD=NONE")) || l.startsWith("#EXT-X-MAP:") || l.startsWith("#EXT-X-BYTERANGE:")) {
                throw new IOException("this server's video format can't be downloaded");
            } else if (l.startsWith("#EXTINF:")) {
                String v = l.substring(8);
                int comma = v.indexOf(',');
                try {
                    dur = Double.parseDouble(comma >= 0 ? v.substring(0, comma) : v);
                } catch (NumberFormatException e) {
                    dur = 0;
                }
            } else if (!l.isEmpty() && !l.startsWith("#")) {
                segs.add(new Segment(new URL(base, l).toString(), dur));
                dur = 0;
            }
        }
        if (segs.isEmpty()) throw new IOException("the video has no segments");
        return segs;
    }

    private static List<String> fetchPlaylist(String url) throws Exception {
        Map<String, String> h = new HashMap<>();
        h.put("User-Agent", LocalServer.BROWSER_UA);
        HttpURLConnection c;
        try {
            c = Net.open("GET", url, h, null);
        } catch (IOException e) {
            throw new IOException("could not load the video playlist: " + e.getMessage());
        }
        try {
            if (c.getResponseCode() != 200) throw new IOException("could not load the video playlist: HTTP " + c.getResponseCode());
            List<String> lines = new ArrayList<>();
            for (String l : Net.readString(c).split("\n")) lines.add(l.trim());
            return lines;
        } finally {
            c.disconnect();
        }
    }

    private byte[] fetchSegment(String url) throws Exception {
        Exception last = null;
        Map<String, String> h = new HashMap<>();
        h.put("User-Agent", LocalServer.BROWSER_UA);
        for (int attempt = 0; attempt < TRIES; attempt++) {
            if (stopCurrent) throw new Stopped();
            if (attempt > 0) Thread.sleep(attempt * 2000L);
            HttpURLConnection c = null;
            try {
                c = Net.open("GET", url, h, null);
                if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
                byte[] body = readLimited(c.getInputStream(), MAX_SEGMENT);
                if (body.length < 188 || body[0] != 0x47) throw new IOException("not a video segment");
                return body;
            } catch (IOException e) {
                last = e;
            } finally {
                if (c != null) c.disconnect();
            }
        }
        throw last;
    }

    // ---- files ------------------------------------------------------------------------------------

    private static byte[] readLimited(InputStream in, int max) throws IOException {
        try (InputStream s = in; ByteArrayOutputStream out = new ByteArrayOutputStream(1 << 20)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = s.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > max) throw new IOException("segment too large");
            }
            return out.toByteArray();
        }
    }

    private static String readText(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            return new String(readLimited(in, 256 << 20), StandardCharsets.UTF_8);
        }
    }

    private static void writeText(File f, String text) throws IOException {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static void readParts(File jobDir, List<long[]> parts, List<Double> durations) {
        try {
            JSONArray list = new JSONArray(readText(new File(jobDir, "parts.json")));
            for (int i = 0; i < list.length(); i++) {
                JSONObject p = list.getJSONObject(i);
                parts.add(new long[]{p.getLong("o"), p.getLong("l")});
                durations.add(p.getDouble("d"));
            }
        } catch (Exception e) {
            parts.clear();
            durations.clear();
        }
    }

    private static void writeParts(File jobDir, List<long[]> parts, List<Double> durations) {
        try {
            JSONArray list = new JSONArray();
            for (int i = 0; i < parts.size(); i++) {
                list.put(new JSONObject().put("o", parts.get(i)[0]).put("l", parts.get(i)[1]).put("d", durations.get(i)));
            }
            writeText(new File(jobDir, "parts.json"), list.toString());
        } catch (Exception ignored) {
            // resuming then starts the episode over
        }
    }

    private static void writePlaylist(File jobDir, List<long[]> parts, List<Double> durations) throws IOException {
        double longest = 1;
        for (double d : durations) longest = Math.max(longest, d);
        StringBuilder b = new StringBuilder("#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-PLAYLIST-TYPE:VOD\n");
        b.append("#EXT-X-TARGETDURATION:").append((int) Math.ceil(longest)).append("\n#EXT-X-MEDIA-SEQUENCE:0\n");
        for (int i = 0; i < parts.size(); i++) {
            b.append(String.format(Locale.ROOT, "#EXTINF:%.3f,\n#EXT-X-BYTERANGE:%d@%d\nvideo.ts\n", durations.get(i), parts.get(i)[1], parts.get(i)[0]));
        }
        b.append("#EXT-X-ENDLIST\n");
        writeText(new File(jobDir, "index.m3u8"), b.toString());
    }

    private static void deleteDir(File d) {
        File[] files = d.listFiles();
        if (files != null) for (File f : files) {
            if (f.isDirectory()) deleteDir(f);
            else f.delete();
        }
        d.delete();
    }

    // ---- HTTP ---------------------------------------------------------------------------------------

    WebResourceResponse handle(String path, Uri url, Map<String, String> headers) throws Exception {
        switch (path) {
            case "/downloads/list":
                return LocalServer.json(200, snapshot().toString());
            case "/downloads/add": {
                String post = url.getQueryParameter("post");
                String lang = url.getQueryParameter("lang");
                if (post == null || !LocalServer.ID.matcher(post).matches() || !("sub".equals(lang) || "dub".equals(lang))) {
                    return LocalServer.json(400, LocalServer.error("invalid download"));
                }
                int quality;
                try {
                    quality = Integer.parseInt(url.getQueryParameter("quality"));
                } catch (Exception e) {
                    quality = 720;
                }
                JSONArray eps = new JSONArray(url.getQueryParameter("eps") == null ? "[]" : url.getQueryParameter("eps"));
                add(post, nonNull(url.getQueryParameter("title")), nonNull(url.getQueryParameter("poster")), lang, quality > 0 ? quality : 720, eps);
                return LocalServer.json(200, snapshot().toString());
            }
            case "/downloads/action": {
                String action = url.getQueryParameter("do");
                if (!"pause".equals(action) && !"resume".equals(action) && !"delete".equals(action)) {
                    return LocalServer.json(400, LocalServer.error("invalid action"));
                }
                String ids = nonNull(url.getQueryParameter("ids"));
                act(action, ids.isEmpty() ? Collections.<String>emptyList() : Arrays.asList(ids.split(",")));
                return LocalServer.json(200, snapshot().toString());
            }
            default:
                if (path.startsWith("/downloads/media/")) return media(path.substring("/downloads/media/".length()), headers);
                return LocalServer.json(404, LocalServer.error("not found"));
        }
    }

    private static String nonNull(String s) {
        return s == null ? "" : s;
    }

    /**
     * A download for the player: index.m3u8 lists every segment by its own URL (seg/N.ts), and each is
     * answered in full from its byte range of video.ts, so playback never depends on the WebView
     * handling range requests on intercepted responses (it reported "fragLoadError" offline). The
     * playlist is generated from parts.json, so earlier downloads play this way too. video.ts itself
     * (with Range) stays available.
     */
    private WebResourceResponse media(String rest, Map<String, String> headers) throws IOException {
        int slash = rest.indexOf('/');
        String id = slash > 0 ? Uri.decode(rest.substring(0, slash)) : "";
        String name = slash > 0 ? rest.substring(slash + 1) : "";
        if (id.isEmpty() || !id.equals(safeId(id))) return LocalServer.json(404, LocalServer.error("not found"));
        File jobDir = new File(dir, id);
        if (name.equals("index.m3u8") || (name.startsWith("seg/") && name.endsWith(".ts"))) {
            List<long[]> parts = new ArrayList<>();
            List<Double> durations = new ArrayList<>();
            readParts(jobDir, parts, durations);
            Map<String, String> out = new HashMap<>();
            out.put("Cache-Control", "no-store");
            if (name.equals("index.m3u8")) {
                if (parts.isEmpty()) return LocalServer.json(404, LocalServer.error("not found"));
                double longest = 1;
                for (double d : durations) longest = Math.max(longest, d);
                StringBuilder b = new StringBuilder("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n");
                b.append("#EXT-X-TARGETDURATION:").append((int) Math.ceil(longest)).append("\n#EXT-X-MEDIA-SEQUENCE:0\n");
                for (int i = 0; i < parts.size(); i++) {
                    b.append(String.format(Locale.ROOT, "#EXTINF:%.3f,\nseg/%d.ts\n", durations.get(i), i));
                }
                b.append("#EXT-X-ENDLIST\n");
                return new WebResourceResponse("application/vnd.apple.mpegurl", "utf-8", 200, "OK", out,
                        new java.io.ByteArrayInputStream(b.toString().getBytes(StandardCharsets.UTF_8)));
            }
            int n;
            try {
                n = Integer.parseInt(name.substring(4, name.length() - 3));
            } catch (NumberFormatException e) {
                n = -1;
            }
            File video = new File(jobDir, "video.ts");
            if (n < 0 || n >= parts.size() || !video.isFile()) return LocalServer.json(404, LocalServer.error("not found"));
            long[] p = parts.get(n);
            FileInputStream in = new FileInputStream(video);
            long skipped = 0;
            while (skipped < p[0]) {
                long k = in.skip(p[0] - skipped);
                if (k <= 0) break;
                skipped += k;
            }
            out.put("Content-Length", String.valueOf(p[1]));
            return new WebResourceResponse("video/mp2t", null, 200, "OK", out, new Limited(in, p[1]));
        }
        if (!name.equals("video.ts")) return LocalServer.json(404, LocalServer.error("not found"));
        File f = new File(jobDir, name);
        if (!f.isFile()) return LocalServer.json(404, LocalServer.error("not found"));
        Map<String, String> out = new HashMap<>();
        out.put("Cache-Control", "no-store");
        out.put("Accept-Ranges", "bytes");
        long length = f.length();
        String range = headers == null ? null : headers.get("Range");
        if (range == null) range = headers == null ? null : headers.get("range");
        Matcher m = range == null ? null : RANGE.matcher(range.trim());
        if (m == null || !m.matches() || (m.group(1).isEmpty() && m.group(2).isEmpty())) {
            out.put("Content-Length", String.valueOf(length));
            return new WebResourceResponse("video/mp2t", null, 200, "OK", out, new FileInputStream(f));
        }
        long start, end;
        if (m.group(1).isEmpty()) { // suffix range: the last N bytes
            start = Math.max(0, length - Long.parseLong(m.group(2)));
            end = length - 1;
        } else {
            start = Long.parseLong(m.group(1));
            end = m.group(2).isEmpty() ? length - 1 : Math.min(length - 1, Long.parseLong(m.group(2)));
        }
        if (start > end || start >= length) {
            out.put("Content-Range", "bytes */" + length);
            return new WebResourceResponse("video/mp2t", null, 416, "Range Not Satisfiable", out, new java.io.ByteArrayInputStream(new byte[0]));
        }
        FileInputStream in = new FileInputStream(f);
        long skipped = 0;
        while (skipped < start) {
            long n = in.skip(start - skipped);
            if (n <= 0) break;
            skipped += n;
        }
        out.put("Content-Range", "bytes " + start + "-" + end + "/" + length);
        out.put("Content-Length", String.valueOf(end - start + 1));
        return new WebResourceResponse("video/mp2t", null, 206, "Partial Content", out, new Limited(in, end - start + 1));
    }

    /** Reads at most `left` bytes of the wrapped stream. */
    private static final class Limited extends FilterInputStream {
        private long left;

        Limited(InputStream in, long left) {
            super(in);
            this.left = left;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long s = super.skip(Math.min(n, left));
            left -= s;
            return s;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), left);
        }
    }
}
