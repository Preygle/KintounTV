// Updates from inside the app. The latest GitHub release is checked at start-up and every few
// hours; when it is newer, the Windows and Android apps can fetch and install it themselves
// (desktop/updater.go, android/.../Updater.java, under /update). In a plain browser there is
// nothing to install, so `installable` stays false and only the release link is offered.
import { useEffect, useSyncExternalStore } from "react";

export const APP_VERSION = __APP_VERSION__;
const LATEST_URL = "https://api.github.com/repos/Preygle/KintounTV/releases/latest";
export const RELEASES_PAGE = "https://github.com/Preygle/KintounTV/releases/latest";
const CHECK_KEY = "kintoun.updateCheck";
const DISMISS_KEY = "kintoun.updateDismissed";
const CHECK_EVERY = 6 * 3600000;

export interface Release {
  version: string;
  notes: string;
  url: string;
}

interface Install {
  state: "idle" | "downloading" | "verifying" | "restarting" | "installing" | "error";
  progress: number;
  error: string;
  platform?: "windows" | "android";
}

interface State {
  latest: Release | null;
  checking: boolean;
  checkedAt: number;
  checkError: string | null;
  installable: boolean | null; // null until the app's /update endpoint has answered
  install: Install;
  dismissed: string;
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // only a convenience
  }
};

const saved = read<{ at: number; latest: Release | null }>(CHECK_KEY, { at: 0, latest: null });
let state: State = {
  latest: saved.latest,
  checking: false,
  checkedAt: saved.at,
  checkError: null,
  installable: null,
  install: { state: "idle", progress: 0, error: "" },
  dismissed: read(DISMISS_KEY, ""),
};
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/** -1, 0 or 1 comparing dotted versions ("1.10.0" > "1.9.3"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export const isNewer = (r: Release | null): r is Release => !!r && compareVersions(r.version, APP_VERSION) > 0;

const VERSION = /^\d+\.\d+\.\d+$/;

/** The latest release from GitHub's API (60 requests an hour per network address). */
async function fromApi(): Promise<Release | null> {
  const res = await fetch(LATEST_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const body = (await res.json()) as { tag_name?: string; body?: string; html_url?: string };
  const version = (body.tag_name ?? "").replace(/^v/, "");
  return VERSION.test(version) ? { version, notes: body.body ?? "", url: body.html_url ?? RELEASES_PAGE } : null;
}

/**
 * When the API refuses (shared networks run out of requests), the app's own server reads the version
 * from GitHub's releases/latest redirect, and the notes come from CHANGELOG.md at that tag.
 */
async function fromApp(): Promise<Release | null> {
  const res = await fetch("/update/latest", { cache: "no-store" });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("GitHub is limiting checks right now; try again later.");
  const { version } = (await res.json()) as { version?: string };
  if (!version || !VERSION.test(version)) return null;
  const changelog = await fetch(`https://raw.githubusercontent.com/Preygle/KintounTV/v${version}/CHANGELOG.md`)
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  const start = changelog.indexOf(`## ${version}`);
  const end = start < 0 ? -1 : changelog.indexOf("\n## ", start + 4);
  const notes = start < 0 ? "" : changelog.slice(changelog.indexOf("\n", start) + 1, end < 0 ? undefined : end);
  return { version, notes, url: `https://github.com/Preygle/KintounTV/releases/tag/v${version}` };
}

export async function checkForUpdate(): Promise<void> {
  if (state.checking) return;
  set({ checking: true, checkError: null });
  try {
    const latest = await fromApi().catch(fromApp);
    write(CHECK_KEY, { at: Date.now(), latest });
    set({ latest, checkedAt: Date.now() });
  } catch (e) {
    set({ checkError: navigator.onLine ? (e as Error).message : "You're offline." });
  } finally {
    set({ checking: false });
  }
}

let polling = 0;
async function pollInstall(): Promise<void> {
  try {
    const res = await fetch("/update/status", { cache: "no-store" });
    if (!(res.headers.get("content-type") ?? "").includes("json")) {
      set({ installable: false }); // the SPA's index.html: no updater in this build
      return;
    }
    const install = (await res.json()) as Install;
    set({ installable: true, install });
    const busy = install.state === "downloading" || install.state === "verifying" || install.state === "restarting" || install.state === "installing";
    window.clearTimeout(polling);
    if (busy) polling = window.setTimeout(pollInstall, install.state === "installing" ? 2000 : 500);
  } catch {
    // restarting: the old server is gone; the new version reloads the page itself
    if (state.install.state === "restarting") polling = window.setTimeout(() => location.reload(), 3000);
  }
}

export async function installUpdate(): Promise<void> {
  if (!isNewer(state.latest)) return;
  set({ install: { ...state.install, state: "downloading", progress: 0, error: "" } });
  await fetch(`/update/start?version=${encodeURIComponent(state.latest.version)}`, { cache: "no-store" }).catch(() => {});
  await pollInstall();
}

export function dismissUpdate() {
  if (!state.latest) return;
  write(DISMISS_KEY, state.latest.version);
  set({ dismissed: state.latest.version });
}

let started = false;
/** Checks at start-up (when the last check is old) and every few hours while the app is open. */
export function startUpdateChecks() {
  if (started) return;
  started = true;
  void pollInstall();
  if (Date.now() - state.checkedAt > CHECK_EVERY) void checkForUpdate();
  window.setInterval(() => {
    if (Date.now() - state.checkedAt > CHECK_EVERY) void checkForUpdate();
  }, 30 * 60000);
}

export function useUpdates(): State {
  useEffect(startUpdateChecks, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function installLabel(i: Install): string {
  switch (i.state) {
    case "downloading":
      return `Downloading… ${Math.round(i.progress * 100)}%`;
    case "verifying":
      return "Checking the download…";
    case "restarting":
      return "Restarting on the new version…";
    case "installing":
      return "Confirm the update in Android's installer";
    default:
      return "";
  }
}
