package app.kintountv.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * Keeps the app running while {@link Downloads} has work, with a progress notification, so a
 * season keeps downloading with the screen off or another app open. Stops itself when idle.
 */
public class DownloadService extends Service {
    private static final String CHANNEL = "downloads";
    private static final int ID = 1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean foreground;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            Downloads d = Downloads.get(DownloadService.this);
            if (!d.busy()) {
                stopForegroundCompat();
                stopSelf();
                return;
            }
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(ID, build(d.describe()));
            handler.postDelayed(this, 2000);
        }
    };

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!foreground) {
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW));
            }
            Notification n = build(Downloads.get(this).describe());
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, n);
            foreground = true;
            handler.post(tick);
        }
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private Notification build(String text) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return b.setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Downloading")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
                .build();
    }

    @SuppressWarnings("deprecation")
    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        foreground = false;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
