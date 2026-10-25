package main

// Makes the WebView behave like an app rather than a browser tab, and remembers the window.
//
// - No status bar (the link address that pops up in a corner), no zoom (Ctrl+wheel, Ctrl +/-,
//   pinch) and no browser shortcuts (Ctrl+P, Ctrl+F, F5, …); the page handles its own keys.
// - A dark background from the first frame, instead of a white flash before the page paints.
// - The window's size, position and maximized state are kept in window.json and restored.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/pkg/edge"
)

// The app's background (#0b0b0d) as WebView2 wants it, for the environment variable below and the
// controller's default background.
const backgroundARGB = "FF0B0B0D"

// prepareWebView must run before the WebView is created: the runtime reads these at start-up.
func prepareWebView() {
	os.Setenv("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", backgroundARGB)
}

// chromiumOf reaches the library's WebView2 object, which it keeps unexported.
func chromiumOf(w webview2.WebView) *edge.Chromium {
	v := reflect.ValueOf(w)
	if v.Kind() != reflect.Pointer || v.Elem().Kind() != reflect.Struct {
		return nil
	}
	f := v.Elem().FieldByName("browser")
	if !f.IsValid() {
		return nil
	}
	f = reflect.NewAt(f.Type(), unsafe.Pointer(f.UnsafeAddr())).Elem()
	c, _ := f.Interface().(*edge.Chromium)
	return c
}

func applyAppSettings(w webview2.WebView) {
	c := chromiumOf(w)
	if c == nil {
		return
	}
	if s, err := c.GetSettings(); err == nil && s != nil {
		s.PutIsStatusBarEnabled(false)
		s.PutIsZoomControlEnabled(false)
		s.PutIsPinchZoomEnabled(false)
		s.PutIsSwipeNavigationEnabled(false)
		s.PutAreBrowserAcceleratorKeysEnabled(false)
	}
	if ctl := c.GetController(); ctl != nil {
		if c2 := ctl.GetICoreWebView2Controller2(); c2 != nil {
			c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 255, R: 0x0b, G: 0x0b, B: 0x0d})
		}
	}
}

// ---- window placement ---------------------------------------------------------------------------

func placementFile() string { return filepath.Join(dataRoot(), "window.json") }

// restorePlacement puts the window back where it was last time (SetWindowPlacement keeps it on a
// connected monitor if that one is gone).
func restorePlacement(hwnd uintptr) {
	data, err := os.ReadFile(placementFile())
	if err != nil {
		return
	}
	var wp windowPlacement
	if json.Unmarshal(data, &wp) != nil || wp.RcNormalPosition.Right-wp.RcNormalPosition.Left < 400 {
		return
	}
	const swShowMinimized, swShowNormal = 2, 1
	wp.Length = uint32(unsafe.Sizeof(windowPlacement{}))
	wp.Flags = 0
	if wp.ShowCmd == swShowMinimized {
		wp.ShowCmd = swShowNormal // never start minimized
	}
	procSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&wp)))
}

// watchPlacement saves the window's placement whenever it changes (not while fullscreen, whose
// borderless monitor-sized window isn't a place to come back to).
func watchPlacement(hwnd uintptr) {
	var last windowPlacement
	for range time.Tick(2 * time.Second) {
		if fullscreen.active {
			continue
		}
		wp := windowPlacement{Length: uint32(unsafe.Sizeof(windowPlacement{}))}
		if ok, _, _ := procGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&wp))); ok == 0 || wp == last {
			continue
		}
		last = wp
		if data, err := json.Marshal(wp); err == nil {
			os.MkdirAll(filepath.Dir(placementFile()), 0o755)
			os.WriteFile(placementFile(), data, 0o644)
		}
	}
}
