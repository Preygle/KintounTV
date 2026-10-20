// KintounTV desktop: a native Windows shell around the web app.
//
// The built SPA is embedded in the executable and served on a fixed loopback address together
// with the /api catalog proxy (api.go), the streaming endpoints (stream.go) and downloads
// (downloads.go), then shown in a
// WebView2 window. The address is fixed so the page origin, and with it localStorage (My List,
// watch progress), stays the same across launches. A second launch focuses the running window.
package main

import (
	"embed"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	webview2 "github.com/jchv/go-webview2"
)

//go:embed all:web
var embedded embed.FS

const (
	appName       = "KintounTV"
	preferredAddr = "127.0.0.1:47613"
)

var (
	window   webview2.WebView
	windowMu sync.Mutex
)

func main() {
	// The Go side only relays data; keep its heap small and let WebView2 have the memory.
	debug.SetMemoryLimit(96 << 20)

	listener, err := net.Listen("tcp", preferredAddr)
	if err != nil {
		if focusRunningInstance() {
			return
		}
		if legacyInstanceRunning() {
			fatal("AniLab, the previous version of " + appName + ", is still open.\n\nClose it and start " + appName + " again. Your list, history and sign-in move over automatically.")
		}
		// Port held by something else: fall back to a random port (saved data will not carry over).
		if listener, err = net.Listen("tcp", "127.0.0.1:0"); err != nil {
			fatal("Could not start the local server:\n" + err.Error())
		}
	}
	host := listener.Addr().String()

	web, _ := fs.Sub(embedded, "web")
	go func() {
		_ = http.Serve(listener, newHandler(host, web, filepath.Join(localAppData(), appName, "Downloads")))
	}()

	dataDir := profileDir()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  dataDir,
		WindowOptions: webview2.WindowOptions{
			Title:  appName,
			Width:  1280,
			Height: 820,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		fatal(appName + " needs the Microsoft Edge WebView2 Runtime.\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start " + appName + " again.")
	}
	defer w.Destroy()

	windowMu.Lock()
	window = w
	windowMu.Unlock()

	hwnd := uintptr(w.Window())
	useDarkTitleBar(hwnd)
	// Called by the page on fullscreenchange; bindings run on the UI thread.
	w.Bind("kintounSetFullscreen", func(on bool) { setFullscreen(hwnd, on) })
	w.SetSize(420, 600, webview2.HintMin)
	w.Navigate("http://" + host + "/")
	w.Run()
}

func newHandler(host string, web fs.FS, downloadsDir string) http.Handler {
	cache := newAPICache()
	streams := newStreamService()
	downloads := newDownloader(downloadsDir, streams)
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		// Only answer requests addressed to our own origin (blocks DNS-rebinding pages)...
		if r.Host != host {
			http.Error(rw, "forbidden", http.StatusForbidden)
			return
		}
		isData := strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/stream/") || strings.HasPrefix(r.URL.Path, "/downloads/") || strings.HasPrefix(r.URL.Path, "/skips/") || r.URL.Path == "/hls"
		// ...and only let our own page use the data endpoints, so other sites open in a browser
		// cannot use them as a relay.
		if site := r.Header.Get("Sec-Fetch-Site"); isData && site != "" && site != "same-origin" && site != "none" {
			http.Error(rw, "forbidden", http.StatusForbidden)
			return
		}
		switch {
		case r.URL.Path == "/__kintoun/focus":
			rw.Write([]byte(appName))
			go focusWindow()
		case strings.HasPrefix(r.URL.Path, "/api/"):
			proxyAPI(rw, r, cache)
		case strings.HasPrefix(r.URL.Path, "/stream/"):
			streams.serve(rw, r)
		case r.URL.Path == "/hls":
			serveHLS(rw, r)
		case r.URL.Path == "/skips/introdb":
			serveIntroDB(rw, r)
		case strings.HasPrefix(r.URL.Path, "/downloads/"):
			downloads.serve(rw, r)
		default:
			serveStatic(rw, r, web)
		}
	})
}

func serveStatic(rw http.ResponseWriter, r *http.Request, web fs.FS) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if info, err := fs.Stat(web, name); name == "" || err != nil || info.IsDir() {
		name = "index.html" // SPA route
	}
	f, err := web.Open(name)
	if err != nil {
		http.NotFound(rw, r)
		return
	}
	defer f.Close()
	if strings.HasPrefix(name, "assets/") {
		rw.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		rw.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(rw, r, name, time.Time{}, f.(io.ReadSeeker))
}

func localAppData() string {
	if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
		return dir
	}
	dir, _ := os.UserCacheDir()
	return dir
}

// profileDir returns the WebView2 profile (My List, history, sign-in, caches). Builds released before
// the rename used %LOCALAPPDATA%\AniLab; that profile is moved once. If it can't be moved (e.g. the
// old app is still open) it is used where it is, so nothing is lost.
func profileDir() string {
	dir := filepath.Join(localAppData(), appName, "WebView2")
	legacy := filepath.Join(localAppData(), "AniLab", "WebView2")
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if _, err := os.Stat(legacy); err == nil {
			if os.MkdirAll(filepath.Dir(dir), 0o755) != nil || os.Rename(legacy, dir) != nil {
				return legacy
			}
		}
	}
	return dir
}
