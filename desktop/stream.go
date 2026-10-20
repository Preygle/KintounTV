package main

// Streaming, as done by KYOTO Player (com.kyotoplayer 1.2.6), the external player AniLab hands off to:
//
//	GET  {kyotoBase}post?id=<AniLab post id>  -> URL templates: episodes, servers, server{url, headers}
//	GET  episodes                             -> {list:[{id,name,number,filler}]}
//	GET  servers   (%id% = episode id)        -> {list:[{id,lang,name}]}
//	GET  server.url (%id% = server id) + headers -> {link: <HLS master playlist>}
//
// The HLS CDN sends no CORS headers, so playlists and segments are relayed through /hls, which
// rewrites every URI in a playlist to point back at the relay.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	kyotoBase      = "https://app.kyotoplayer.com/api/v4/"
	kyotoUserAgent = "okhttp/4.12.0"
	browserUA      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
	configTTL      = 10 * time.Minute
	episodesTTL    = 5 * time.Minute
	maxPlaylist    = 8 << 20
)

// streamClient has no overall timeout because segment bodies are streamed to the player. The dial
// timeout is split across a host's addresses, so one unreachable CDN IP doesn't stall playback.
var streamClient = &http.Client{Transport: &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	DialContext:           (&net.Dialer{Timeout: 8 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
	TLSHandshakeTimeout:   10 * time.Second,
	MaxIdleConnsPerHost:   8,
	ResponseHeaderTimeout: 20 * time.Second,
	IdleConnTimeout:       90 * time.Second,
	ForceAttemptHTTP2:     true,
}}

// doWithRetry retries once on a network error (not on HTTP error statuses); flaky mobile links
// often fail the first connection and succeed straight after.
func doWithRetry(req *http.Request) (*http.Response, error) {
	res, err := streamClient.Do(req)
	if err != nil && req.Context().Err() == nil {
		res, err = streamClient.Do(req.Clone(req.Context()))
	}
	return res, err
}

type scrapRequest struct {
	URL     string     `json:"url"`
	Headers [][]string `json:"headers"`
}

type postConfig struct {
	Episodes string       `json:"episodes"`
	Servers  string       `json:"servers"`
	Server   scrapRequest `json:"server"`
}

type timed[T any] struct {
	value T
	at    time.Time
}

type ttlCache[T any] struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[string]timed[T]
}

func newTTLCache[T any](ttl time.Duration) *ttlCache[T] {
	return &ttlCache[T]{ttl: ttl, entries: map[string]timed[T]{}}
}

func (c *ttlCache[T]) get(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || time.Since(e.at) > c.ttl {
		var zero T
		return zero, false
	}
	return e.value, true
}

func (c *ttlCache[T]) put(key string, v T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) > 512 {
		c.entries = map[string]timed[T]{}
	}
	c.entries[key] = timed[T]{v, time.Now()}
}

type streamService struct {
	configs  *ttlCache[postConfig]
	episodes *ttlCache[json.RawMessage]
}

func newStreamService() *streamService {
	return &streamService{configs: newTTLCache[postConfig](configTTL), episodes: newTTLCache[json.RawMessage](episodesTTL)}
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_./-]{1,64}$`)

func (s *streamService) serve(rw http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(rw, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	var (
		body []byte
		err  error
	)
	switch r.URL.Path {
	case "/stream/episodes":
		body, err = s.listEpisodes(r.Context(), q.Get("id"))
	case "/stream/servers":
		body, err = s.listServers(r.Context(), q.Get("id"), q.Get("episode"))
	case "/stream/source":
		body, err = s.source(r.Context(), q.Get("id"), q.Get("server"))
	default:
		http.NotFound(rw, r)
		return
	}
	if err != nil {
		writeJSONError(rw, err)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.Header().Set("Cache-Control", "no-store")
	rw.Write(body)
}

type httpError struct {
	status  int
	message string
}

func (e *httpError) Error() string { return e.message }

func writeJSONError(rw http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	var he *httpError
	if errors.As(err, &he) {
		status = he.status
	}
	msg, _ := json.Marshal(map[string]string{"error": err.Error()})
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(status)
	rw.Write(msg)
}

func badRequest(field string) error {
	return &httpError{http.StatusBadRequest, "invalid " + field}
}

func (s *streamService) config(ctx context.Context, postID string) (postConfig, error) {
	if !idPattern.MatchString(postID) {
		return postConfig{}, badRequest("id")
	}
	if c, ok := s.configs.get(postID); ok {
		return c, nil
	}
	data, err := fetchBytes(ctx, kyotoBase+"post?id="+url.QueryEscape(postID), map[string]string{"User-Agent": kyotoUserAgent, "Accept": "application/json"})
	if err != nil {
		return postConfig{}, fmt.Errorf("streaming service unreachable: %w", err)
	}
	var c postConfig
	if err := json.Unmarshal(data, &c); err != nil || c.Episodes == "" || c.Servers == "" || c.Server.URL == "" {
		return postConfig{}, errors.New("no streams available for this title")
	}
	s.configs.put(postID, c)
	return c, nil
}

func (s *streamService) listEpisodes(ctx context.Context, postID string) ([]byte, error) {
	c, err := s.config(ctx, postID)
	if err != nil {
		return nil, err
	}
	if cached, ok := s.episodes.get(postID); ok {
		return cached, nil
	}
	data, err := fetchBytes(ctx, c.Episodes, map[string]string{"User-Agent": kyotoUserAgent, "Accept": "application/json"})
	if err != nil {
		return nil, fmt.Errorf("could not load episodes: %w", err)
	}
	if !json.Valid(data) {
		return nil, errors.New("episode list is not valid JSON")
	}
	s.episodes.put(postID, data)
	return data, nil
}

func (s *streamService) listServers(ctx context.Context, postID, episodeID string) ([]byte, error) {
	if !idPattern.MatchString(episodeID) {
		return nil, badRequest("episode")
	}
	c, err := s.config(ctx, postID)
	if err != nil {
		return nil, err
	}
	data, err := fetchBytes(ctx, strings.ReplaceAll(c.Servers, "%id%", episodeID), map[string]string{"User-Agent": kyotoUserAgent, "Accept": "application/json"})
	if err != nil {
		return nil, fmt.Errorf("could not load servers: %w", err)
	}
	if !json.Valid(data) {
		return nil, errors.New("server list is not valid JSON")
	}
	return data, nil
}

func (s *streamService) source(ctx context.Context, postID, serverID string) ([]byte, error) {
	link, err := s.link(ctx, postID, serverID)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]string{"url": relayPath(link)})
}

// link resolves a server to its HLS master playlist on the video CDN.
func (s *streamService) link(ctx context.Context, postID, serverID string) (string, error) {
	if !idPattern.MatchString(serverID) {
		return "", badRequest("server")
	}
	c, err := s.config(ctx, postID)
	if err != nil {
		return "", err
	}
	headers := map[string]string{"User-Agent": kyotoUserAgent, "Accept": "application/json"}
	for _, h := range c.Server.Headers {
		if len(h) == 2 {
			headers[h[0]] = h[1]
		}
	}
	data, err := fetchBytes(ctx, strings.ReplaceAll(c.Server.URL, "%id%", serverID), headers)
	if err != nil {
		return "", fmt.Errorf("could not load the video source: %w", err)
	}
	var iframe struct {
		Link string `json:"link"`
	}
	if err := json.Unmarshal(data, &iframe); err != nil || iframe.Link == "" {
		return "", errors.New("this server has no video right now — try another one")
	}
	link, err := url.Parse(iframe.Link)
	if err != nil || link.Scheme != "https" {
		return "", errors.New("unsupported video link")
	}
	return link.String(), nil
}

func fetchBytes(ctx context.Context, target string, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := doWithRetry(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, maxPlaylist))
}

func relayPath(target string) string { return "/hls?u=" + url.QueryEscape(target) }

var uriAttr = regexp.MustCompile(`URI="([^"]+)"`)

// serveHLS relays one playlist or media segment. Playlists are rewritten so that every variant,
// segment, key and map URI is fetched through the relay as well.
func serveHLS(rw http.ResponseWriter, r *http.Request) {
	target, err := url.Parse(r.URL.Query().Get("u"))
	if err != nil || target.Scheme != "https" || target.Host == "" {
		http.Error(rw, "bad url", http.StatusBadRequest)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		http.Error(rw, "bad url", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", browserUA)
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}
	res, err := doWithRetry(req)
	if err != nil {
		http.Error(rw, "upstream unreachable", http.StatusBadGateway)
		return
	}
	defer res.Body.Close()

	contentType := res.Header.Get("Content-Type")
	isPlaylist := strings.HasSuffix(strings.ToLower(target.Path), ".m3u8") || strings.Contains(strings.ToLower(contentType), "mpegurl")
	if !isPlaylist {
		// Segments arrive disguised (".xls", application/vnd.ms-excel) but are plain MPEG-TS.
		if strings.HasSuffix(strings.ToLower(target.Path), ".ts") || !strings.HasPrefix(contentType, "video/") {
			contentType = "video/mp2t"
		}
		rw.Header().Set("Content-Type", contentType)
		for _, h := range []string{"Content-Length", "Content-Range", "Accept-Ranges"} {
			if v := res.Header.Get(h); v != "" {
				rw.Header().Set(h, v)
			}
		}
		rw.Header().Set("Cache-Control", "private, max-age=3600")
		rw.WriteHeader(res.StatusCode)
		io.Copy(rw, res.Body)
		return
	}

	if res.StatusCode != http.StatusOK {
		http.Error(rw, "playlist unavailable", http.StatusBadGateway)
		return
	}
	var out strings.Builder
	scanner := bufio.NewScanner(io.LimitReader(res.Body, maxPlaylist))
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	resolve := func(ref string) string {
		u, err := target.Parse(strings.TrimSpace(ref))
		if err != nil {
			return ref
		}
		return relayPath(u.String())
	}
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "":
		case strings.HasPrefix(line, "#"):
			line = uriAttr.ReplaceAllStringFunc(line, func(m string) string {
				return `URI="` + resolve(uriAttr.FindStringSubmatch(m)[1]) + `"`
			})
		default:
			line = resolve(line)
		}
		out.WriteString(line)
		out.WriteByte('\n')
	}
	rw.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	rw.Header().Set("Cache-Control", "no-store")
	io.WriteString(rw, out.String())
}
