package main

import (
	"io"
	"net/http"
	"os"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32                  = syscall.NewLazyDLL("user32.dll")
	procShowWindow          = user32.NewProc("ShowWindow")
	procIsIconic            = user32.NewProc("IsIconic")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procAllowSetForeground  = user32.NewProc("AllowSetForegroundWindow")
	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procGetWindowLongPtrW   = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW   = user32.NewProc("SetWindowLongPtrW")
	procGetWindowPlacement  = user32.NewProc("GetWindowPlacement")
	procSetWindowPlacement  = user32.NewProc("SetWindowPlacement")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procMonitorFromWindow   = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfoW     = user32.NewProc("GetMonitorInfoW")
	procGetForegroundWindow = user32.NewProc("GetForegroundWindow")
	procDwmSetWindowAttr    = syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
)

type rect struct{ Left, Top, Right, Bottom int32 }

type point struct{ X, Y int32 }

type windowPlacement struct {
	Length           uint32
	Flags            uint32
	ShowCmd          uint32
	PtMinPosition    point
	PtMaxPosition    point
	RcNormalPosition rect
}

type monitorInfo struct {
	CbSize    uint32
	RcMonitor rect
	RcWork    rect
	DwFlags   uint32
}

// fullscreen tracks the window state saved when the page enters fullscreen. WebView2 only makes
// the element fill the WebView, so the host must turn the window itself into a borderless
// monitor-sized window (and restore it afterwards). Only touched on the UI thread.
//
// Flicker-safe mode (the default; a setting on the Account page): a window that exactly covers the
// monitor is treated by Windows as a fullscreen game — the video is flipped straight to the display
// and variable-refresh monitors follow the video's frame rate, which makes some of them flicker. A
// window one pixel short of the monitor stays composed by the desktop at its normal refresh rate.
// To still cover the taskbar it is kept topmost while it is the active window.
var fullscreen struct {
	active    bool
	safe      bool
	topmost   bool
	style     uintptr
	placement windowPlacement
}

func init() { fullscreen.safe = true }

const (
	hwndTopmost   = ^uintptr(0) // HWND_TOPMOST (-1)
	hwndNoTopmost = ^uintptr(1) // HWND_NOTOPMOST (-2)
	swpNoActivate = 0x0010
)

// setFullscreenMode switches flicker-safe fullscreen on or off (re-applied if fullscreen now).
func setFullscreenMode(hwnd uintptr, safe bool) {
	if safe == fullscreen.safe {
		return
	}
	if !fullscreen.active {
		fullscreen.safe = safe
		return
	}
	setFullscreen(hwnd, false)
	fullscreen.safe = safe
	setFullscreen(hwnd, true)
}

// watchFullscreenFocus keeps a flicker-safe fullscreen window above the taskbar while it is the
// active window, and lets other windows come in front when the user switches to them.
func watchFullscreenFocus(w interface{ Dispatch(func()) }, hwnd uintptr) {
	for range time.Tick(300 * time.Millisecond) {
		w.Dispatch(func() {
			if !fullscreen.active || !fullscreen.safe {
				return
			}
			fg, _, _ := procGetForegroundWindow.Call()
			if want := fg == hwnd; want != fullscreen.topmost {
				after := hwndNoTopmost
				if want {
					after = hwndTopmost
				}
				const swpNoSize, swpNoMove = 0x0001, 0x0002
				procSetWindowPos.Call(hwnd, after, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
				fullscreen.topmost = want
			}
		})
	}
}

func setFullscreen(hwnd uintptr, on bool) {
	const (
		gwlStyle           = ^uintptr(15) // GWL_STYLE (-16)
		wsOverlappedWindow = 0x00CF0000
		monitorDefaultNear = 2
		swpNoSize          = 0x0001
		swpNoMove          = 0x0002
		swpNoZOrder        = 0x0004
		swpNoOwnerZOrder   = 0x0200
		swpFrameChanged    = 0x0020
		hwndTop            = 0
	)
	if on == fullscreen.active {
		return
	}
	if on {
		style, _, _ := procGetWindowLongPtrW.Call(hwnd, gwlStyle)
		fullscreen.placement = windowPlacement{Length: uint32(unsafe.Sizeof(windowPlacement{}))}
		procGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&fullscreen.placement)))
		mi := monitorInfo{CbSize: uint32(unsafe.Sizeof(monitorInfo{}))}
		monitor, _, _ := procMonitorFromWindow.Call(hwnd, monitorDefaultNear)
		if ok, _, _ := procGetMonitorInfoW.Call(monitor, uintptr(unsafe.Pointer(&mi))); ok == 0 {
			return
		}
		fullscreen.style = style
		procSetWindowLongPtrW.Call(hwnd, gwlStyle, style&^wsOverlappedWindow)
		r := mi.RcMonitor
		after, height := uintptr(hwndTop), r.Bottom-r.Top
		if fullscreen.safe {
			after, height = hwndTopmost, height-1
		}
		procSetWindowPos.Call(hwnd, after, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(height), swpNoOwnerZOrder|swpFrameChanged)
		fullscreen.topmost = fullscreen.safe
	} else {
		if fullscreen.topmost {
			procSetWindowPos.Call(hwnd, hwndNoTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
			fullscreen.topmost = false
		}
		procSetWindowLongPtrW.Call(hwnd, gwlStyle, fullscreen.style)
		procSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&fullscreen.placement)))
		procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoZOrder|swpNoOwnerZOrder|swpFrameChanged)
	}
	fullscreen.active = on
}

// focusRunningInstance asks an instance already listening on the preferred address to bring its
// window forward. It returns false when the port belongs to some other program.
func focusRunningInstance() bool {
	return askToFocus("/__kintoun/focus", appName)
}

// legacyInstanceRunning reports whether a build from before the rename (AniLab) holds the address,
// bringing its window forward. Its profile can only be moved once it is closed.
func legacyInstanceRunning() bool {
	return askToFocus("/__anilab/focus", "AniLab")
}

func askToFocus(path, name string) bool {
	const asfwAny = ^uintptr(0) // ASFW_ANY: let the running instance take the foreground
	procAllowSetForeground.Call(asfwAny)
	client := http.Client{Timeout: 2 * time.Second}
	res, err := client.Get("http://" + preferredAddr + path)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64))
	return res.StatusCode == http.StatusOK && string(body) == name
}

func focusWindow() {
	windowMu.Lock()
	w := window
	windowMu.Unlock()
	if w == nil {
		return
	}
	w.Dispatch(func() {
		hwnd := uintptr(w.Window())
		const swRestore = 9
		if minimized, _, _ := procIsIconic.Call(hwnd); minimized != 0 {
			procShowWindow.Call(hwnd, swRestore)
		}
		procSetForegroundWindow.Call(hwnd)
	})
}

// useDarkTitleBar matches the window frame to the app's dark theme (Windows 10 20H1+ / 11).
func useDarkTitleBar(hwnd uintptr) {
	const dwmwaUseImmersiveDarkMode = 20
	enabled := int32(1)
	procDwmSetWindowAttr.Call(hwnd, dwmwaUseImmersiveDarkMode, uintptr(unsafe.Pointer(&enabled)), unsafe.Sizeof(enabled))
}

func fatal(message string) {
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString(appName)
	const mbIconError = 0x10
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbIconError)
	os.Exit(1)
}
