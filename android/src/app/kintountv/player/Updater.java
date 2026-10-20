package app.kintountv.player;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * In-app updates (Android counterpart of desktop/updater.go). The page finds a newer release
 * (src/updates.ts) and calls /update/start?version=x.y.z: the APK of that release of this
 * repository is downloaded, checked against the release's SHA256SUMS.txt and handed to Android's
 * package installer, which asks the user to confirm. /update/status reports progress.
 */
final class Updater {
    private static final String RELEASES = "https://github.com/Preygle/KintounTV/releases/download/v";
    private static final String ASSET = "KintounTV.apk";
    private static final String ACTION = "app.kintountv.player.UPDATE_STATUS";
    private static final Pattern VERSION = Pattern.compile("^\\d+\\.\\d+\\.\\d+$");
    private static final long MAX_APK = 64L << 20;

    private static Updater instance;

    /** One per process: the activity is recreated (rotation), the installer callback must not be. */
    static synchronized Updater get(Context context) {
        if (instance == null) instance = new Updater(context);
        return instance;
    }

    private final Context context;
    private String state = "idle"; // idle | downloading | verifying | installing | error
    private double progress;
    private String error = "";
    private String version = "";

    private Updater(Context context) {
        this.context = context.getApplicationContext();
        IntentFilter filter = new IntentFilter(ACTION);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            @SuppressWarnings("deprecation")
            public void onReceive(Context c, Intent intent) {
                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    // Android's "Update this app?" screen (and, the first time, the switch that
                    // allows KintounTV to install apps).
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) c.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } else if (status == PackageInstaller.STATUS_SUCCESS) {
                    set("idle", 1, ""); // usually never seen: Android restarts the app on the new version
                } else {
                    String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                    set("error", 0, status == PackageInstaller.STATUS_FAILURE_ABORTED ? "Update cancelled."
                            : "The update couldn't be installed" + (message == null ? "." : ": " + message));
                }
            }
        };
        if (Build.VERSION.SDK_INT >= 33) this.context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else this.context.registerReceiver(receiver, filter);
    }

    private synchronized void set(String state, double progress, String error) {
        this.state = state;
        this.progress = progress;
        this.error = error;
    }

    WebResourceResponse handle(String path, Uri url) throws Exception {
        if (path.equals("/update/start")) {
            String v = url.getQueryParameter("version");
            if (v == null || !VERSION.matcher(v).matches()) return LocalServer.json(400, LocalServer.error("invalid version"));
            start(v);
        } else if (!path.equals("/update/status")) {
            return LocalServer.json(404, LocalServer.error("not found"));
        }
        synchronized (this) {
            return LocalServer.json(200, new JSONObject().put("state", state).put("progress", progress).put("error", error)
                    .put("version", version).put("platform", "android").toString());
        }
    }

    private synchronized void start(final String v) {
        if (state.equals("downloading") || state.equals("verifying")) return;
        state = "downloading";
        progress = 0;
        error = "";
        version = v;
        new Thread(new Runnable() {
            @Override
            public void run() {
                File apk = new File(context.getCacheDir(), "update.apk");
                try {
                    download(v, apk);
                    set("installing", 1, "");
                    install(apk);
                } catch (Exception e) {
                    set("error", 0, e.getMessage() == null ? e.toString() : e.getMessage());
                } finally {
                    apk.delete();
                }
            }
        }, "update").start();
    }

    private void download(String v, File dest) throws Exception {
        String dir = RELEASES + v + "/";
        Map<String, String> h = new HashMap<>();
        h.put("User-Agent", LocalServer.BROWSER_UA);
        String want = null;
        HttpURLConnection c = Net.open("GET", dir + "SHA256SUMS.txt", h, null);
        try {
            if (c.getResponseCode() != 200) throw new IOException("could not reach the release (HTTP " + c.getResponseCode() + ")");
            for (String line : Net.readString(c).split("\n")) {
                String[] f = line.trim().split("\\s+");
                if (f.length == 2 && f[1].replace("*", "").equals(ASSET)) want = f[0].toLowerCase(Locale.ROOT);
            }
        } finally {
            c.disconnect();
        }
        if (want == null || want.length() != 64) throw new IOException("the release has no checksum for " + ASSET);

        c = Net.open("GET", dir + ASSET, h, null);
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        try {
            if (c.getResponseCode() != 200) throw new IOException("download failed (HTTP " + c.getResponseCode() + ")");
            long total = c.getContentLength();
            long got = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    got += n;
                    if (got > MAX_APK) throw new IOException("the download is larger than expected");
                    out.write(buf, 0, n);
                    sha.update(buf, 0, n);
                    if (total > 0) set("downloading", (double) got / total, "");
                }
            }
        } finally {
            c.disconnect();
        }
        set("verifying", 1, "");
        StringBuilder hex = new StringBuilder();
        for (byte b : sha.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
        if (!hex.toString().equals(want)) throw new IOException("the download didn't match the release's checksum, so it wasn't installed");
    }

    private void install(File apk) throws Exception {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("KintounTV.apk", 0, apk.length())) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent status = new Intent(ACTION).setPackage(context.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(context, id, status, flags).getIntentSender());
        }
    }
}
