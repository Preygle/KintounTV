package main

// In-app updates. The page finds a newer release on GitHub (src/updates.ts) and asks for it here:
//
//	GET /update/start?version=1.4.2  -> downloads KintounTV.exe of release v1.4.2 from this repository,
//	                                    checks it against the release's SHA256SUMS.txt, swaps it in for
//	                                    the running exe and restarts on it
//	GET /update/status               -> {state, progress, error, version, platform}
//
// Only this repository's release files are fetched (the page passes a version, never a URL), and a
// file whose checksum doesn't match is thrown away. Windows lets a running exe be renamed but not
// overwritten, so the old one becomes KintounTV.exe.old (deleted by the next start).

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	releaseBase  = "https://github.com/Preygle/KintounTV/releases/download/"
	updateAsset  = "KintounTV.exe"
	afterUpdate  = "--after-update" // argument of the restarted exe: wait for the old one to exit
	maxUpdateExe = 64 << 20
)

var versionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

type updater struct {
	mu       sync.Mutex
	state    string // idle | downloading | verifying | restarting | error
	progress float64
	err      string
	version  string

	base    string                  // release download base; replaced in tests
	install func(newExe string) error // swaps in the new exe and restarts; replaced in tests
}

func newUpdater() *updater {
	base := releaseBase
	if b := os.Getenv("KINTOUN_UPDATE_BASE"); b != "" { // local test releases
		base = b
	}
	return &updater{state: "idle", base: base, install: installAndRestart}
}

func (u *updater) set(state string, progress float64, err string) {
	u.mu.Lock()
	u.state, u.progress, u.err = state, progress, err
	u.mu.Unlock()
}

func (u *updater) start(version string) error {
	if !versionPattern.MatchString(version) {
		return badRequest("version")
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.state == "downloading" || u.state == "verifying" || u.state == "restarting" {
		return nil // already on it
	}
	u.state, u.progress, u.err, u.version = "downloading", 0, "", version
	go u.run(version)
	return nil
}

func (u *updater) run(version string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	self, err := os.Executable()
	if err != nil {
		u.set("error", 0, err.Error())
		return
	}
	newExe := self + ".new"
	err = u.download(ctx, version, newExe)
	if err == nil {
		u.set("restarting", 1, "")
		err = u.install(newExe)
	}
	if err != nil {
		os.Remove(newExe)
		u.set("error", 0, err.Error())
	}
}

func (u *updater) download(ctx context.Context, version, dest string) error {
	dir := u.base + "v" + version + "/"
	sums, err := fetchBytes(ctx, dir+"SHA256SUMS.txt", map[string]string{"User-Agent": browserUA})
	if err != nil {
		return fmt.Errorf("could not reach the release: %v", err)
	}
	want := ""
	sc := bufio.NewScanner(strings.NewReader(string(sums)))
	for sc.Scan() {
		if f := strings.Fields(sc.Text()); len(f) == 2 && strings.TrimPrefix(f[1], "*") == updateAsset {
			want = strings.ToLower(f[0])
		}
	}
	if len(want) != 64 {
		return errors.New("the release has no checksum for " + updateAsset)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dir+updateAsset, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", browserUA)
	res, err := doWithRetry(req)
	if err != nil {
		return fmt.Errorf("download failed: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", res.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("could not save the update: %v", err)
	}
	hash := sha256.New()
	total := res.ContentLength
	var got int64
	buf := make([]byte, 64<<10)
	for {
		n, rerr := res.Body.Read(buf)
		if n > 0 {
			got += int64(n)
			if got > maxUpdateExe {
				f.Close()
				return errors.New("the download is larger than expected")
			}
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				return fmt.Errorf("could not save the update: %v", werr)
			}
			hash.Write(buf[:n])
			if total > 0 {
				u.set("downloading", float64(got)/float64(total), "")
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			return fmt.Errorf("download failed: %v", rerr)
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	u.set("verifying", 1, "")
	if hex.EncodeToString(hash.Sum(nil)) != want {
		return errors.New("the download didn't match the release's checksum, so it wasn't installed")
	}
	return nil
}

// installAndRestart moves the running exe aside, puts the new one in its place, starts it and closes
// this window. The new process waits for this one to release the port (see waitForPreviousExit).
func installAndRestart(newExe string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	old := self + ".old"
	os.Remove(old)
	if err := os.Rename(self, old); err != nil {
		return fmt.Errorf("could not replace the app: %v", err)
	}
	if err := os.Rename(newExe, self); err != nil {
		os.Rename(old, self)
		return fmt.Errorf("could not replace the app: %v", err)
	}
	cmd := exec.Command(self, afterUpdate, strconv.Itoa(os.Getpid()))
	cmd.Dir = filepath.Dir(self)
	if err := cmd.Start(); err != nil {
		os.Rename(self, newExe)
		os.Rename(old, self)
		return fmt.Errorf("could not start the new version: %v", err)
	}
	// Give the page a moment to show "Restarting…", then close.
	time.AfterFunc(700*time.Millisecond, func() {
		windowMu.Lock()
		w := window
		windowMu.Unlock()
		if w != nil {
			w.Dispatch(w.Terminate)
		}
		time.AfterFunc(5*time.Second, func() { os.Exit(0) })
	})
	return nil
}

// waitForPreviousExit is called at startup: after an update, the previous version may still be
// closing and holding the address, so retry for a while instead of focusing it. It also deletes the
// previous exe once it is free.
func waitForPreviousExit(listen func() error) {
	if len(os.Args) < 3 || os.Args[1] != afterUpdate {
		return
	}
	deadline := time.Now().Add(15 * time.Second)
	for listen() != nil && time.Now().Before(deadline) {
		time.Sleep(250 * time.Millisecond)
	}
}

func removePreviousExe() {
	self, err := os.Executable()
	if err != nil {
		return
	}
	for i := 0; i < 20; i++ {
		if err := os.Remove(self + ".old"); err == nil || os.IsNotExist(err) {
			return
		}
		time.Sleep(time.Second)
	}
}

func (u *updater) serve(rw http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/update/start":
		if err := u.start(r.URL.Query().Get("version")); err != nil {
			writeJSONError(rw, err)
			return
		}
	case "/update/status":
	default:
		http.NotFound(rw, r)
		return
	}
	u.mu.Lock()
	body, _ := json.Marshal(map[string]any{"state": u.state, "progress": u.progress, "error": u.err, "version": u.version, "platform": "windows"})
	u.mu.Unlock()
	rw.Header().Set("Content-Type", "application/json")
	rw.Header().Set("Cache-Control", "no-store")
	rw.Write(body)
}
