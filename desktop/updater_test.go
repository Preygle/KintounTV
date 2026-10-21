package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUpdaterVerifiesChecksum(t *testing.T) {
	exe := bytes.Repeat([]byte("new build "), 50000)
	sum := sha256.Sum256(exe)
	served := exe
	release := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v9.9.9/SHA256SUMS.txt":
			rw.Write([]byte(hex.EncodeToString(sum[:]) + "  KintounTV.exe\nabc  KintounTV.apk\n"))
		case "/v9.9.9/KintounTV.exe":
			rw.Write(served)
		default:
			http.NotFound(rw, r)
		}
	}))
	defer release.Close()

	installed := ""
	u := newUpdater()
	u.base = release.URL + "/"
	u.install = func(newExe string) error {
		data, _ := os.ReadFile(newExe)
		installed = string(data)
		return nil
	}
	wait := func() string {
		for i := 0; i < 200; i++ {
			u.mu.Lock()
			s := u.state
			u.mu.Unlock()
			if s == "restarting" || s == "error" {
				return s
			}
			time.Sleep(10 * time.Millisecond)
		}
		return "timeout"
	}

	if err := u.start("../evil"); err == nil {
		t.Fatal("accepted a version that isn't x.y.z")
	}
	if err := u.start("9.9.9"); err != nil {
		t.Fatal(err)
	}
	if s := wait(); s != "restarting" || installed != string(exe) {
		t.Fatalf("state %s, installed %d bytes", s, len(installed))
	}

	// A file that doesn't match the published checksum is not installed.
	served = append([]byte("tampered"), exe...)
	installed = ""
	u.set("idle", 0, "")
	u.start("9.9.9")
	if s := wait(); s != "error" || installed != "" {
		t.Fatalf("tampered download: state %s, installed %d bytes", s, len(installed))
	}
	self, _ := os.Executable()
	if _, err := os.Stat(self + ".new"); !os.IsNotExist(err) {
		t.Fatal("rejected download left behind", filepath.Base(self)+".new")
	}
}

// Live: the latest release is read from GitHub's releases/latest redirect.
// Run with LIVE_API=1 go test -run TestLatestVersion .
func TestLatestVersion(t *testing.T) {
	if os.Getenv("LIVE_API") == "" {
		t.Skip("set LIVE_API=1 to ask GitHub")
	}
	v, err := latestVersion(t.Context())
	if err != nil || !versionPattern.MatchString(v) {
		t.Fatalf("got %q, %v", v, err)
	}
	t.Log("latest release:", v)
}
