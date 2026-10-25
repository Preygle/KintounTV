// Windows app integration (desktop/main.go provides the window.kintoun* bindings; in a browser or on
// Android they are absent and this module does nothing beyond the in-page keys).
//
// - App fullscreen (F11 or the header button): the whole app fills the screen, remembered between
//   launches. The player's own fullscreen works inside it; the window stays fullscreen as long as
//   either wants it.
// - Flicker-safe fullscreen (a setting): see desktop/window.go.
// - Alt+Left / Alt+Right and the mouse's back/forward buttons navigate, as the browser keys that did
//   this are turned off in the app.
import { useSyncExternalStore } from "react";

declare global {
  interface Window {
    kintounSetFullscreen?: (on: boolean) => Promise<void>;
    kintounSetFullscreenMode?: (safe: boolean) => Promise<void>;
  }
}

const APP_FULLSCREEN_KEY = "kintoun.appFullscreen";
const SAFE_KEY = "kintoun.flickerSafeFullscreen";

export const isDesktopApp = typeof window !== "undefined" && typeof window.kintounSetFullscreen === "function";

const read = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
const write = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // only a convenience
  }
};

let state = { appFullscreen: isDesktopApp && read(APP_FULLSCREEN_KEY, false), flickerSafe: read(SAFE_KEY, true) };
const listeners = new Set<() => void>();
const set = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useDesktop() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Tells the window whether it should be fullscreen: the app's choice or an element (the player). */
export function syncWindowFullscreen() {
  window.kintounSetFullscreen?.(state.appFullscreen || document.fullscreenElement != null).catch(() => {});
}

export function setAppFullscreen(on: boolean) {
  if (!isDesktopApp) return;
  write(APP_FULLSCREEN_KEY, on);
  set({ appFullscreen: on });
  syncWindowFullscreen();
}

export const toggleAppFullscreen = () => setAppFullscreen(!state.appFullscreen);

export function setFlickerSafe(on: boolean) {
  write(SAFE_KEY, on);
  set({ flickerSafe: on });
  window.kintounSetFullscreenMode?.(on).catch(() => {});
}

let started = false;
export function startDesktop() {
  if (started) return;
  started = true;
  if (isDesktopApp) {
    window.kintounSetFullscreenMode?.(state.flickerSafe).catch(() => {});
    syncWindowFullscreen(); // restores app fullscreen, and leaves a stale player fullscreen after a reload
  }
  window.addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === "F11" && isDesktopApp) {
      e.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else toggleAppFullscreen();
    } else if (e.key === "Escape" && state.appFullscreen && !document.fullscreenElement && !typing && !document.querySelector(".player-menu, .modal-backdrop")) {
      setAppFullscreen(false);
    } else if (e.altKey && !e.ctrlKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (e.key === "ArrowLeft") history.back();
      else history.forward();
    }
  });
  // Mouse back/forward buttons (button 3 and 4).
  // preventDefault stops the WebView's own handling, so one click goes back exactly once.
  window.addEventListener("mouseup", (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.button === 3) history.back();
    else history.forward();
  });
}
