package app.kintountv.player;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Small HTTP helpers shared by the API proxy, the streaming lookups and the HLS relay. */
final class Net {
    static final int MAX_BODY = 8 << 20;

    private Net() {}

    /** Opens a connection; retries once on a network error (flaky mobile links). */
    static HttpURLConnection open(String method, String url, Map<String, String> headers, byte[] body) throws IOException {
        IOException last = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(10000);
                c.setReadTimeout(20000);
                c.setInstanceFollowRedirects(true);
                if (headers != null) for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
                if (body != null) {
                    c.setDoOutput(true);
                    c.setFixedLengthStreamingMode(body.length);
                    try (OutputStream out = c.getOutputStream()) {
                        out.write(body);
                    }
                }
                c.getResponseCode(); // forces the request; throws on network errors
                return c;
            } catch (IOException e) {
                last = e;
                if (c != null) c.disconnect();
            }
        }
        throw last;
    }

    /** Reads the body (error bodies included) up to MAX_BODY bytes. */
    static byte[] readAll(HttpURLConnection c) throws IOException {
        InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
        if (in == null) return new byte[0];
        try (InputStream s = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = s.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BODY) throw new IOException("response too large");
            }
            return out.toByteArray();
        }
    }

    static String readString(HttpURLConnection c) throws IOException {
        return new String(readAll(c), StandardCharsets.UTF_8);
    }
}
