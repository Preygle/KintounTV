package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	upstreamBase = "https://anilab2.amdapi.click/api/"
	apiCacheTTL  = 3 * time.Minute
	apiCacheMax  = 256
	maxPostBody  = 64 << 10
)

// Mirrors UPSTREAM_HEADERS in ../upstream.mjs.
var upstreamHeaders = map[string]string{
	"Accept":       "application/json",
	"Content-Type": "application/json",
	"os-version":   "34",
	"app-id":       "com.xo.anilab",
	"app-version":  "105",
	"os-id":        "",
}

// Mirrors ALLOWED_ENDPOINTS in ../upstream.mjs.
var allowedEndpoints = map[string]bool{
	"home": true, "config": true, "categories": true, "category": true,
	"latest": true, "post": true, "search": true, "list": true,
}

var upstreamClient = &http.Client{Timeout: 20 * time.Second}

func proxyAPI(rw http.ResponseWriter, r *http.Request, cache *apiCache) {
	endpoint := strings.TrimPrefix(r.URL.Path, "/api/")
	if !allowedEndpoints[endpoint] || (r.Method != http.MethodGet && r.Method != http.MethodPost) {
		http.Error(rw, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	target := upstreamBase + endpoint
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}

	// My List arrives as GET list?page=N&ids=1,2,3 (the Android app can't read intercepted POST
	// bodies); the upstream wants POST list?page=N with {"ids":[...]}. Mirrors listAsPost in ../upstream.mjs.
	method := r.Method
	var listBody []byte
	if endpoint == "list" && r.Method == http.MethodGet {
		ids := []int{}
		for _, s := range strings.Split(r.URL.Query().Get("ids"), ",") {
			if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil && n > 0 {
				ids = append(ids, n)
			}
		}
		listBody, _ = json.Marshal(map[string][]int{"ids": ids})
		page := r.URL.Query().Get("page")
		if page == "" {
			page = "1"
		}
		target = upstreamBase + "list?page=" + url.QueryEscape(page)
		method = http.MethodPost
	}

	if method == http.MethodGet {
		if e, ok := cache.get(target); ok {
			writeAPI(rw, e.status, e.contentType, e.body)
			return
		}
	}

	var body io.Reader
	if listBody != nil {
		body = bytes.NewReader(listBody)
	} else if r.Method == http.MethodPost {
		data, err := io.ReadAll(io.LimitReader(r.Body, maxPostBody+1))
		if err != nil || len(data) > maxPostBody {
			http.Error(rw, "request too large", http.StatusRequestEntityTooLarge)
			return
		}
		body = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(r.Context(), method, target, body)
	if err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	for k, v := range upstreamHeaders {
		req.Header.Set(k, v)
	}
	res, err := upstreamClient.Do(req)
	if err != nil {
		http.Error(rw, `{"error":"upstream unreachable"}`, http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		http.Error(rw, `{"error":"upstream read failed"}`, http.StatusBadGateway)
		return
	}
	contentType := res.Header.Get("Content-Type")
	if method == http.MethodGet && res.StatusCode == http.StatusOK {
		cache.put(target, apiEntry{status: res.StatusCode, contentType: contentType, body: data, at: time.Now()})
	}
	writeAPI(rw, res.StatusCode, contentType, data)
}

func writeAPI(rw http.ResponseWriter, status int, contentType string, body []byte) {
	if contentType == "" {
		contentType = "application/json"
	}
	rw.Header().Set("Content-Type", contentType)
	rw.Header().Set("Cache-Control", "no-store")
	rw.WriteHeader(status)
	rw.Write(body)
}

type apiEntry struct {
	status      int
	contentType string
	body        []byte
	at          time.Time
}

// apiCache keeps successful GET responses for a few minutes. The upstream marks them no-cache,
// so without this every back-navigation would hit the network again.
type apiCache struct {
	mu      sync.Mutex
	entries map[string]apiEntry
}

func newAPICache() *apiCache { return &apiCache{entries: map[string]apiEntry{}} }

func (c *apiCache) get(key string) (apiEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || time.Since(e.at) > apiCacheTTL {
		delete(c.entries, key)
		return apiEntry{}, false
	}
	return e, true
}

func (c *apiCache) put(key string, e apiEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= apiCacheMax {
		for k, v := range c.entries {
			if time.Since(v.at) > apiCacheTTL || len(c.entries) >= apiCacheMax {
				delete(c.entries, k)
			}
		}
	}
	c.entries[key] = e
}
