package main

// Downloads: episodes saved to disk for offline viewing, played back by the in-app player.
//
// Each episode becomes one folder under %LOCALAPPDATA%\KintounTV\Downloads\<id>:
//
//	video.ts    the HLS segments of one rendition, appended in order (plain MPEG-TS; VLC plays it too)
//	parts.json  byte offset, length and duration of every finished segment (lets a download resume)
//	index.m3u8  written at the end: a byte-range playlist over video.ts for the player
//
// Downloads run one episode at a time, a few segments in parallel, and survive restarts. The source
// link is looked up when a download starts (CDN links expire) and again if the CDN starts refusing
// segments part-way through. The Android app does the same in Downloads.java; keep them in sync.
//
//	GET /downloads/list                         -> {items, dir}
//	GET /downloads/add?post&title&poster&lang&quality&eps=[{id,number,name}]
//	GET /downloads/action?do=pause|resume|delete&ids=a,b
//	GET /downloads/open                         -> opens the folder in Explorer
//	GET /downloads/media/<id>/index.m3u8|video.ts

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	segmentWorkers = 4
	segmentTries   = 3
	maxSegment     = 64 << 20
	segmentIdle    = 20 * time.Second
)

// idleReader pushes back its timer on every read, so only a stalled transfer times out.
type idleReader struct {
	r     io.Reader
	timer *time.Timer
}

func (ir idleReader) Read(p []byte) (int, error) {
	n, err := ir.r.Read(p)
	if n > 0 {
		ir.timer.Reset(segmentIdle)
	}
	return n, err
}

type download struct {
	ID        string  `json:"id"`
	PostID    string  `json:"postId"`
	Title     string  `json:"title"`
	Poster    string  `json:"poster"`
	EpisodeID string  `json:"episodeId"`
	Number    string  `json:"number"`
	Name      string  `json:"name"`
	Lang      string  `json:"lang"`    // sub | dub
	Quality   int     `json:"quality"` // highest wanted height
	Height    int     `json:"height"`  // rendition being downloaded
	Status    string  `json:"status"`  // queued | downloading | paused | done | error
	Error     string  `json:"error,omitempty"`
	Segments  int     `json:"segments"`
	Done      int     `json:"done"`
	Bytes     int64   `json:"bytes"`
	Duration  float64 `json:"duration"`
	Added     int64   `json:"added"`

	parts   []part
	deleted bool
}

type part struct {
	Offset   int64   `json:"o"`
	Length   int64   `json:"l"`
	Duration float64 `json:"d"`
}

type segment struct {
	url      string
	duration float64
}

type downloader struct {
	mu      sync.Mutex
	dir     string
	jobs    map[string]*download
	order   []string
	streams *streamService
	wake    chan struct{}
	current *download
	// resolver finds an episode's segments; d.resolve, replaced in tests.
	resolver func(ctx context.Context, j *download, height int) ([]segment, int, error)
	stop     context.CancelFunc
	saved    time.Time
}

var safeID = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

func downloadID(postID, episodeID, lang string) string {
	return safeID.ReplaceAllString(postID+"-"+episodeID+"-"+lang, "_")
}

func newDownloader(dir string, streams *streamService) *downloader {
	d := &downloader{dir: dir, jobs: map[string]*download{}, streams: streams, wake: make(chan struct{}, 1)}
	d.resolver = d.resolve
	d.load()
	go d.work()
	return d
}

// ---- state --------------------------------------------------------------------------------------

func (d *downloader) load() {
	data, err := os.ReadFile(filepath.Join(d.dir, "downloads.json"))
	if err != nil {
		return
	}
	var list []*download
	if json.Unmarshal(data, &list) != nil {
		return
	}
	for _, j := range list {
		if j.ID == "" || j.ID != safeID.ReplaceAllString(j.ID, "_") {
			continue
		}
		if j.Status == "done" {
			if _, err := os.Stat(filepath.Join(d.dir, j.ID, "index.m3u8")); err != nil {
				continue // removed by hand
			}
		}
		if j.Status == "downloading" {
			j.Status = "queued"
		}
		d.jobs[j.ID] = j
		d.order = append(d.order, j.ID)
	}
}

// saveLocked writes the job list; callers hold d.mu.
func (d *downloader) saveLocked() {
	list := make([]*download, 0, len(d.order))
	for _, id := range d.order {
		list = append(list, d.jobs[id])
	}
	data, _ := json.MarshalIndent(list, "", " ")
	if os.MkdirAll(d.dir, 0o755) != nil {
		return
	}
	tmp := filepath.Join(d.dir, "downloads.json.tmp")
	if os.WriteFile(tmp, data, 0o644) == nil {
		os.Rename(tmp, filepath.Join(d.dir, "downloads.json"))
	}
	d.saved = time.Now()
}

func (d *downloader) poke() {
	select {
	case d.wake <- struct{}{}:
	default:
	}
}

func (d *downloader) snapshot() []download {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]download, 0, len(d.order))
	for _, id := range d.order {
		j := *d.jobs[id]
		j.parts = nil
		out = append(out, j)
	}
	return out
}

type addEpisode struct {
	ID     string `json:"id"`
	Number string `json:"number"`
	Name   string `json:"name"`
}

func (d *downloader) add(postID, title, poster, lang string, quality int, eps []addEpisode) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, ep := range eps {
		if !idPattern.MatchString(ep.ID) {
			continue
		}
		id := downloadID(postID, ep.ID, lang)
		if j, ok := d.jobs[id]; ok {
			if j.Status == "paused" || j.Status == "error" {
				j.Status, j.Error = "queued", ""
			}
			continue
		}
		d.jobs[id] = &download{
			ID: id, PostID: postID, Title: title, Poster: poster, EpisodeID: ep.ID, Number: ep.Number, Name: ep.Name,
			Lang: lang, Quality: quality, Status: "queued", Added: time.Now().UnixMilli(),
		}
		d.order = append(d.order, id)
	}
	d.saveLocked()
	d.poke()
}

func (d *downloader) act(action string, ids []string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, id := range ids {
		j, ok := d.jobs[id]
		if !ok {
			continue
		}
		switch action {
		case "pause":
			if j.Status == "queued" || j.Status == "downloading" {
				j.Status = "paused"
				if d.current == j {
					d.stop()
				}
			}
		case "resume":
			if j.Status == "paused" || j.Status == "error" {
				j.Status, j.Error = "queued", ""
			}
		case "delete":
			j.deleted = true
			delete(d.jobs, id)
			for i, o := range d.order {
				if o == id {
					d.order = append(d.order[:i], d.order[i+1:]...)
					break
				}
			}
			if d.current == j {
				d.stop() // the worker removes the folder once the file is closed
			} else {
				os.RemoveAll(filepath.Join(d.dir, id))
			}
		}
	}
	d.saveLocked()
	d.poke()
}

// ---- worker -------------------------------------------------------------------------------------

func (d *downloader) next() *download {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, id := range d.order {
		if j := d.jobs[id]; j.Status == "queued" {
			return j
		}
	}
	return nil
}

func (d *downloader) work() {
	for {
		j := d.next()
		if j == nil {
			<-d.wake
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		d.mu.Lock()
		d.current, d.stop = j, cancel
		j.Status = "downloading"
		d.saveLocked()
		d.mu.Unlock()

		err := d.run(ctx, j)
		cancel()

		d.mu.Lock()
		d.current, d.stop = nil, nil
		switch {
		case j.deleted:
			os.RemoveAll(filepath.Join(d.dir, j.ID))
		case err == nil:
			j.Status, j.Error, j.parts = "done", "", nil
		case ctx.Err() != nil:
			// paused
		default:
			j.Status, j.Error = "error", err.Error()
		}
		d.saveLocked()
		d.mu.Unlock()
	}
}

func (d *downloader) run(ctx context.Context, j *download) error {
	dir := filepath.Join(d.dir, j.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	segs, height, err := d.resolver(ctx, j, 0)
	if err != nil {
		return err
	}

	// Resume where a previous run stopped, if it was the same rendition.
	parts := readParts(dir)
	if j.Segments != len(segs) || j.Height != height || len(parts) > len(segs) {
		parts = nil
	}
	var size int64
	if n := len(parts); n > 0 {
		size = parts[n-1].Offset + parts[n-1].Length
	}
	f, err := os.OpenFile(filepath.Join(dir, "video.ts"), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := f.Truncate(size); err != nil {
		return err
	}
	if _, err := f.Seek(size, io.SeekStart); err != nil {
		return err
	}
	d.mu.Lock()
	j.Segments, j.Height, j.parts = len(segs), height, parts
	j.Done, j.Bytes, j.Duration = len(parts), size, 0
	for _, p := range parts {
		j.Duration += p.Duration
	}
	d.mu.Unlock()

	// A sliding window: segmentWorkers requests in flight, written to the file in order as they land.
	type result struct {
		body []byte
		err  error
	}
	pending := map[int]chan result{}
	refreshed := false
	for next, launch := len(parts), len(parts); next < len(segs); {
		for ; launch < len(segs) && launch-next < segmentWorkers; launch++ {
			ch := make(chan result, 1)
			pending[launch] = ch
			go func(url string) {
				body, err := fetchSegment(ctx, url)
				ch <- result{body, err}
			}(segs[launch].url)
		}
		var r result
		select {
		case r = <-pending[next]:
		case <-ctx.Done():
			return ctx.Err()
		}
		delete(pending, next)
		if r.err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// The CDN link may have expired: look it up again once, then give up.
			if refreshed {
				return fmt.Errorf("episode %s stopped at %d%%: %v", j.Number, 100*next/len(segs), r.err)
			}
			fresh, _, rerr := d.resolver(ctx, j, height)
			if rerr != nil || len(fresh) != len(segs) {
				return fmt.Errorf("the video link expired and could not be renewed")
			}
			segs, refreshed = fresh, true
			pending, launch = map[int]chan result{}, next // requests still running finish into their buffers
			continue
		}
		if _, err := f.Write(r.body); err != nil {
			return fmt.Errorf("could not write to disk: %v", err)
		}
		p := part{Offset: size, Length: int64(len(r.body)), Duration: segs[next].duration}
		size += p.Length
		next++
		d.mu.Lock()
		j.parts = append(j.parts, p)
		j.Done, j.Bytes, j.Duration = len(j.parts), size, j.Duration+p.Duration
		if time.Since(d.saved) > 5*time.Second {
			writeParts(dir, j.parts)
			d.saveLocked()
		}
		d.mu.Unlock()
	}

	d.mu.Lock()
	parts = j.parts
	d.mu.Unlock()
	writeParts(dir, parts)
	return writePlaylist(dir, parts)
}

// resolve finds a server in the wanted language, its rendition closest to (not above) the wanted
// quality — or exactly `height` when renewing a link — and that rendition's segments.
func (d *downloader) resolve(ctx context.Context, j *download, height int) ([]segment, int, error) {
	data, err := d.streams.listServers(ctx, j.PostID, j.EpisodeID)
	if err != nil {
		return nil, 0, err
	}
	var servers struct {
		List []struct {
			ID   string `json:"id"`
			Lang string `json:"lang"`
		} `json:"list"`
	}
	json.Unmarshal(data, &servers)
	tried := map[string]bool{}
	lastErr := fmt.Errorf("no %s servers for episode %s", strings.ToUpper(j.Lang), j.Number)
	for _, s := range servers.List {
		if s.Lang != j.Lang || tried[s.ID] {
			continue
		}
		tried[s.ID] = true
		link, err := d.streams.link(ctx, j.PostID, s.ID)
		if err != nil {
			lastErr = err
			continue
		}
		segs, h, err := pickRendition(ctx, link, j.Quality, height)
		if err != nil {
			lastErr = err
			continue
		}
		return segs, h, nil
	}
	return nil, 0, lastErr
}

var resolutionAttr = regexp.MustCompile(`RESOLUTION=\d+x(\d+)`)

func pickRendition(ctx context.Context, master string, quality, exact int) ([]segment, int, error) {
	base, _ := url.Parse(master)
	lines, err := fetchPlaylist(ctx, master)
	if err != nil {
		return nil, 0, err
	}
	type variant struct {
		uri    string
		height int
	}
	var variants []variant
	for i, l := range lines {
		if strings.HasPrefix(l, "#EXT-X-STREAM-INF:") && i+1 < len(lines) {
			h := 0
			if m := resolutionAttr.FindStringSubmatch(l); m != nil {
				h, _ = strconv.Atoi(m[1])
			}
			if u, err := base.Parse(lines[i+1]); err == nil {
				variants = append(variants, variant{u.String(), h})
			}
		}
	}
	if len(variants) == 0 {
		segs, err := parseMedia(base, lines)
		return segs, 0, err
	}
	sort.Slice(variants, func(a, b int) bool { return variants[a].height > variants[b].height })
	pick := variants[len(variants)-1]
	for _, v := range variants {
		if (exact > 0 && v.height == exact) || (exact == 0 && v.height <= quality) {
			pick = v
			break
		}
	}
	media, _ := url.Parse(pick.uri)
	lines, err = fetchPlaylist(ctx, pick.uri)
	if err != nil {
		return nil, 0, err
	}
	segs, err := parseMedia(media, lines)
	return segs, pick.height, err
}

func parseMedia(base *url.URL, lines []string) ([]segment, error) {
	var segs []segment
	dur := 0.0
	for _, l := range lines {
		switch {
		case strings.HasPrefix(l, "#EXT-X-KEY:") && !strings.Contains(l, "METHOD=NONE"),
			strings.HasPrefix(l, "#EXT-X-MAP:"), strings.HasPrefix(l, "#EXT-X-BYTERANGE:"):
			return nil, errors.New("this server's video format can't be downloaded")
		case strings.HasPrefix(l, "#EXTINF:"):
			dur, _ = strconv.ParseFloat(strings.TrimSuffix(strings.SplitN(l[8:], ",", 2)[0], ","), 64)
		case l != "" && !strings.HasPrefix(l, "#"):
			u, err := base.Parse(l)
			if err != nil {
				return nil, err
			}
			segs = append(segs, segment{u.String(), dur})
			dur = 0
		}
	}
	if len(segs) == 0 {
		return nil, errors.New("the video has no segments")
	}
	return segs, nil
}

func fetchPlaylist(ctx context.Context, target string) ([]string, error) {
	data, err := fetchBytes(ctx, target, map[string]string{"User-Agent": browserUA})
	if err != nil {
		return nil, fmt.Errorf("could not load the video playlist: %w", err)
	}
	var lines []string
	sc := bufio.NewScanner(strings.NewReader(string(data)))
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		lines = append(lines, strings.TrimSpace(sc.Text()))
	}
	return lines, nil
}

func fetchSegment(ctx context.Context, target string) ([]byte, error) {
	var last error
	for attempt := 0; attempt < segmentTries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt) * 2 * time.Second):
			}
		}
		body, err := func() ([]byte, error) {
			// Give up on a request that has received nothing for segmentIdle; the retry usually flows.
			rctx, cancel := context.WithCancel(ctx)
			defer cancel()
			idle := time.AfterFunc(segmentIdle, cancel)
			defer idle.Stop()
			req, err := http.NewRequestWithContext(rctx, http.MethodGet, target, nil)
			if err != nil {
				return nil, err
			}
			req.Header.Set("User-Agent", browserUA)
			res, err := doWithRetry(req)
			if err != nil {
				return nil, err
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				return nil, fmt.Errorf("HTTP %d", res.StatusCode)
			}
			idle.Reset(segmentIdle)
			body, err := io.ReadAll(io.LimitReader(idleReader{res.Body, idle}, maxSegment))
			if err == nil && (len(body) < 188 || body[0] != 0x47) {
				err = errors.New("not a video segment")
			}
			return body, err
		}()
		if err == nil {
			return body, nil
		}
		last = err
	}
	return nil, last
}

func readParts(dir string) []part {
	data, err := os.ReadFile(filepath.Join(dir, "parts.json"))
	if err != nil {
		return nil
	}
	var parts []part
	if json.Unmarshal(data, &parts) != nil {
		return nil
	}
	return parts
}

func writeParts(dir string, parts []part) {
	data, _ := json.Marshal(parts)
	os.WriteFile(filepath.Join(dir, "parts.json"), data, 0o644)
}

func writePlaylist(dir string, parts []part) error {
	longest := 1.0
	for _, p := range parts {
		longest = math.Max(longest, p.Duration)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:%d\n#EXT-X-MEDIA-SEQUENCE:0\n", int(math.Ceil(longest)))
	for _, p := range parts {
		fmt.Fprintf(&b, "#EXTINF:%.3f,\n#EXT-X-BYTERANGE:%d@%d\nvideo.ts\n", p.Duration, p.Length, p.Offset)
	}
	b.WriteString("#EXT-X-ENDLIST\n")
	return os.WriteFile(filepath.Join(dir, "index.m3u8"), []byte(b.String()), 0o644)
}

// ---- HTTP ---------------------------------------------------------------------------------------

func (d *downloader) serve(rw http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	writeJSON := func(v any) {
		rw.Header().Set("Content-Type", "application/json")
		rw.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(rw).Encode(v)
	}
	list := func() { writeJSON(map[string]any{"items": d.snapshot(), "dir": d.dir}) }

	switch {
	case r.URL.Path == "/downloads/list":
		list()
	case r.URL.Path == "/downloads/add":
		var eps []addEpisode
		post := q.Get("post")
		lang := q.Get("lang")
		quality, _ := strconv.Atoi(q.Get("quality"))
		if !idPattern.MatchString(post) || (lang != "sub" && lang != "dub") || json.Unmarshal([]byte(q.Get("eps")), &eps) != nil {
			writeJSONError(rw, badRequest("download"))
			return
		}
		if quality <= 0 {
			quality = 720
		}
		d.add(post, q.Get("title"), q.Get("poster"), lang, quality, eps)
		list()
	case r.URL.Path == "/downloads/action":
		action := q.Get("do")
		if action != "pause" && action != "resume" && action != "delete" {
			writeJSONError(rw, badRequest("action"))
			return
		}
		d.act(action, strings.Split(q.Get("ids"), ","))
		list()
	case r.URL.Path == "/downloads/open":
		os.MkdirAll(d.dir, 0o755)
		exec.Command("explorer.exe", d.dir).Start()
		writeJSON(map[string]bool{"ok": true})
	case strings.HasPrefix(r.URL.Path, "/downloads/media/"):
		d.serveMedia(rw, r, strings.TrimPrefix(r.URL.Path, "/downloads/media/"))
	default:
		http.NotFound(rw, r)
	}
}

func (d *downloader) serveMedia(rw http.ResponseWriter, r *http.Request, rest string) {
	id, name, ok := strings.Cut(rest, "/")
	if !ok || id == "" || id != safeID.ReplaceAllString(id, "_") || (name != "index.m3u8" && name != "video.ts") {
		http.NotFound(rw, r)
		return
	}
	f, err := os.Open(filepath.Join(d.dir, id, name))
	if err != nil {
		http.NotFound(rw, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.NotFound(rw, r)
		return
	}
	if name == "index.m3u8" {
		rw.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	} else {
		rw.Header().Set("Content-Type", "video/mp2t")
	}
	rw.Header().Set("Cache-Control", "no-store")
	http.ServeContent(rw, r, name, info.ModTime(), f)
}
