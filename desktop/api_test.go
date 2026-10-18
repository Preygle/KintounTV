package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// Live test (hits the real upstream AniLab API): GET /api/list?ids= must be converted to the upstream POST.
// Run with LIVE_API=1 go test -run TestListGetBecomesPost .
func TestListGetBecomesPost(t *testing.T) {
	if os.Getenv("LIVE_API") == "" {
		t.Skip("set LIVE_API=1 to run against the real API")
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/list?page=1&ids=1000001230,1000004979", nil)
	proxyAPI(rec, req, newAPICache())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Posts []struct {
			ID int `json:"id"`
		} `json:"posts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Posts) != 2 {
		t.Fatalf("want 2 posts, got %d: %s", len(res.Posts), rec.Body.String())
	}
}
