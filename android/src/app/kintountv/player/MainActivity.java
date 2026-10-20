package app.kintountv.player;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * KintounTV for Android: the same web app as the desktop exe, in a WebView. The bundled site and the
 * /api, /stream and /hls endpoints are served from a fixed in-app origin by {@link LocalServer},
 * so storage (My List, watch history, account) persists. Outside pages open in the system browser.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;

    private WebView web;
    private LocalServer server;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private WebChromeClient chrome;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Downloads downloads = Downloads.get(this);
        // Android 13+: the download progress notification needs permission; ask on the first download.
        downloads.onFirstAdd = new Runnable() {
            @Override
            public void run() {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
                        }
                    }
                });
            }
        };
        server = new LocalServer(getAssets(), downloads);

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(13, 13, 18));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!HOST.equals(url.getHost())) return null;
                return server.handle(request.getMethod(), url, request.getRequestHeaders());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                openExternal(url.toString());
                return true;
            }
        });

        chrome = new WebChromeClient() {
            // Fullscreen API (the player's fullscreen button / F key / double-click).
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customCallback = callback;
                ((FrameLayout) getWindow().getDecorView()).addView(view, new FrameLayout.LayoutParams(-1, -1));
                setSystemBarsHidden(true);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                ((FrameLayout) getWindow().getDecorView()).removeView(customView);
                customView = null;
                setSystemBarsHidden(false);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                if (customCallback != null) customCallback.onCustomViewHidden();
                customCallback = null;
            }
        };
        web.setWebChromeClient(chrome);

        setContentView(web);
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(ORIGIN + "/");
    }

    void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException ignored) {
            // No browser installed; nothing sensible to do.
        }
    }

    @SuppressWarnings("deprecation")
    private void setSystemBarsHidden(boolean hidden) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (hidden) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                c.show(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(hidden
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    : 0);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) {
            chrome.onHideCustomView();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
