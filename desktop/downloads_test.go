package main

import (
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func waitFor(t *testing.T, d *downloader, id string, timeout time.Duration) download {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, j := range d.snapshot() {
			if j.ID == id && (j.Status == "done" || j.Status == "error") {
				return j
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("download %s did not finish", id)
	return download{}
}

// A download whose CDN link expires part-way: segments under /old/ are refused after the first two,
// and the renewed link (/new/) serves the rest.
func TestDownloadRenewsExpiredLink(t *testing.T) {
	seg := func(n int) []byte { return append([]byte{0x47}, bytes.Repeat([]byte{byte(n)}, 187*2)...) }
	cdn := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		var n int
		var gen string
		fmt.Sscanf(strings.ReplaceAll(r.URL.Path, "/", " "), "%s %d", &gen, &n)
		if gen == "old" && n >= 2 {
			rw.WriteHeader(http.StatusForbidden)
			return
		}
		rw.Write(seg(n))
	}))
	defer cdn.Close()

	dir := t.TempDir()
	d := newDownloader(dir, nil)
	resolves := 0
	d.resolver = func(ctx context.Context, j *download, height int) ([]segment, int, error) {
		gen := "old"
		if resolves++; resolves > 1 {
			gen = "new"
		}
		var segs []segment
		for i := 0; i < 7; i++ {
			segs = append(segs, segment{fmt.Sprintf("%s/%s/%d", cdn.URL, gen, i), 2.5})
		}
		return segs, 360, nil
	}
	d.add("100", "Show", "", "sub", 360, []addEpisode{{ID: "5", Number: "1"}})
	j := waitFor(t, d, downloadID("100", "5", "sub"), 30*time.Second)
	if j.Status != "done" || j.Done != 7 || j.Height != 360 {
		t.Fatalf("got %+v", j)
	}
	video, _ := os.ReadFile(filepath.Join(dir, j.ID, "video.ts"))
	var want []byte
	for i := 0; i < 7; i++ {
		want = append(want, seg(i)...)
	}
	if !bytes.Equal(video, want) {
		t.Fatalf("video.ts has %d bytes, want %d in segment order", len(video), len(want))
	}
	playlist, _ := os.ReadFile(filepath.Join(dir, j.ID, "index.m3u8"))
	if !strings.Contains(string(playlist), "#EXT-X-BYTERANGE:375@375\nvideo.ts") || !strings.HasSuffix(string(playlist), "#EXT-X-ENDLIST\n") {
		t.Fatalf("playlist:\n%s", playlist)
	}

	// The player gets one URL per segment, each answered in full (no range requests needed).
	get := func(path string) (int, []byte) {
		rec := httptest.NewRecorder()
		d.serve(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec.Code, rec.Body.Bytes()
	}
	code, list := get("/downloads/media/" + j.ID + "/index.m3u8")
	if code != 200 || !strings.Contains(string(list), "#EXTINF:2.500,\nseg/0.ts\n") || !strings.Contains(string(list), "seg/6.ts") || strings.Contains(string(list), "BYTERANGE") {
		t.Fatalf("segment playlist %d:\n%s", code, list)
	}
	if code, body := get("/downloads/media/" + j.ID + "/seg/3.ts"); code != 200 || !bytes.Equal(body, seg(3)) {
		t.Fatalf("seg/3.ts: %d, %d bytes", code, len(body))
	}
	if code, _ := get("/downloads/media/" + j.ID + "/seg/7.ts"); code != 404 {
		t.Fatalf("segment past the end: %d", code)
	}

	// The list survives a restart.
	again := newDownloader(dir, nil)
	if s := again.snapshot(); len(s) != 1 || s[0].Status != "done" {
		t.Fatalf("after restart: %+v", s)
	}
	again.act("delete", []string{j.ID})
	if _, err := os.Stat(filepath.Join(dir, j.ID)); !os.IsNotExist(err) {
		t.Fatal("delete left the folder behind")
	}
}

// Live test: downloads one real episode at 360p, then (with KINTOUN_SERVE_FOR=90s) keeps the app's
// server running on 127.0.0.1:47699 so the result can be checked in a browser.
// Run with LIVE_DOWNLOAD=1 go test -run TestLiveDownload -timeout 20m .
func TestLiveDownload(t *testing.T) {
	if os.Getenv("LIVE_DOWNLOAD") == "" {
		t.Skip("set LIVE_DOWNLOAD=1 to download from the real CDN")
	}
	dir := os.Getenv("KINTOUN_DOWNLOADS")
	if dir == "" {
		dir = t.TempDir()
	}
	host := "127.0.0.1:47699"
	web, _ := fs.Sub(embedded, "web")
	handler := newHandler(host, web, dir)
	ln, err := net.Listen("tcp", host)
	if err != nil {
		t.Fatal(err)
	}
	go http.Serve(ln, handler)
	get := func(path string) string {
		res, err := http.Get("http://" + host + path)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var b bytes.Buffer
		b.ReadFrom(res.Body)
		return b.String()
	}
	eps := `[{"id":"1906","number":"1","name":""}]`
	get("/downloads/add?post=1000000457&title=Attack+on+Titan&lang=sub&quality=360&eps=" + eps)
	start := time.Now()
	for {
		body := get("/downloads/list")
		if strings.Contains(body, `"status":"done"`) || strings.Contains(body, `"status":"error"`) {
			t.Logf("after %s: %s", time.Since(start).Round(time.Second), body)
			if strings.Contains(body, `"status":"error"`) {
				t.Fatal("download failed")
			}
			break
		}
		time.Sleep(2 * time.Second)
	}
	if d, err := time.ParseDuration(os.Getenv("KINTOUN_SERVE_FOR")); err == nil {
		time.Sleep(d)
	}
}
