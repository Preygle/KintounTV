// Username + password accounts and sync of My List and watch history (Firebase, via its REST APIs).
//
// Auth: Firebase email/password. A plain username is mapped to a synthetic address
// (<name>@users.anilab.app); a real email address also works and allows password resets. Firebase
// refresh tokens don't expire on a schedule, so each device signs in once.
// Data: one Firestore document per account, users/{uid}, holding the JSON payload; the security
// rules (README, "Sync") only let an account read/write its own document. Each device pulls,
// merges (newest change per entry wins, see myList.ts / progress.ts) and pushes.
import { useSyncExternalStore } from "react";
import { getMyListState, mergeMyList, replaceMyList, subscribeMyList, type MyListState } from "./myList";
import { getProgressState, mergeProgress, replaceProgress, subscribeProgress, type ProgressData } from "./progress";

const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY ?? "";
const PROJECT = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "";
// Local Firebase emulators (tests only), e.g. "127.0.0.1:9099" / "127.0.0.1:8085".
const AUTH_EMULATOR = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR ?? "";
const DB_EMULATOR = import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR ?? "";
export const syncConfigured = Boolean(API_KEY && PROJECT);

const AUTH_URL = AUTH_EMULATOR ? `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1` : "https://identitytoolkit.googleapis.com/v1";
const TOKEN_URL = AUTH_EMULATOR ? `http://${AUTH_EMULATOR}/securetoken.googleapis.com/v1/token` : "https://securetoken.googleapis.com/v1/token";
const DB_URL = `${DB_EMULATOR ? `http://${DB_EMULATOR}` : "https://firestore.googleapis.com"}/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH_KEY = "anilab.account";
const USERNAME = /^[a-z0-9._-]{3,30}$/;
// Predates the KintounTV name and stays: account emails are derived from it, so changing it would
// orphan existing accounts.
const SYNTHETIC_DOMAIN = "users.anilab.app";

const LIST_DELAY = 3000; // My List edits sync quickly
// Watch progress changes every few seconds, so it is batched; other devices' changes are polled
// while the app is on screen. Fast sync (on by default, a per-account setting that syncs with the
// account) keeps two devices within ~30 s: 15 s + 15 s, plus an upload when the app is left and a
// pull when it is opened. Normal sync uses about a quarter of the database requests.
const TIMING = {
  fast: { progress: 15000, poll: 15000, onReturn: 5000 },
  normal: { progress: 60000, poll: 5 * 60000, onReturn: 60000 },
};
const SETTINGS_KEY = "kintoun.syncSettings";

export interface Account {
  username: string; // what the user typed (a username or an email address)
}

interface AuthData {
  uid: string;
  username: string;
  refreshToken: string;
  idToken?: string;
  expiresAt?: number;
}

export interface SyncState {
  status: "signed-out" | "idle" | "syncing" | "error";
  account?: Account;
  lastSync?: number;
  error?: string;
  fastSync: boolean;
}

/** Account settings; the newer change (at) wins when devices disagree. */
interface SyncSettings {
  fastSync: boolean;
  at: number;
}

const DEFAULT_SETTINGS: SyncSettings = { fastSync: true, at: 0 };

interface Payload {
  v: 1;
  updatedAt?: number;
  myList: MyListState;
  progress: ProgressData;
  settings?: SyncSettings;
}

// ---- state -----------------------------------------------------------------------------------------

function loadAuth(): AuthData | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthData) : null;
  } catch {
    return null;
  }
}

function saveAuth() {
  try {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    // ignore
  }
}

function loadSettings(uid: string | undefined): SyncSettings {
  try {
    const all = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, SyncSettings>;
    return (uid && all[uid]) || DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings() {
  if (!auth) return;
  try {
    const all = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, SyncSettings>;
    all[auth.uid] = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

let auth = syncConfigured ? loadAuth() : null;
let settings = loadSettings(auth?.uid);
let state: SyncState = auth ? { status: "idle", account: { username: auth.username }, fastSync: settings.fastSync } : { status: "signed-out", fastSync: settings.fastSync };
const timing = () => (settings.fastSync ? TIMING.fast : TIMING.normal);

/** Turns fast sync on or off for the signed-in account (on every device it is signed in on). */
export function setFastSync(on: boolean) {
  settings = { fastSync: on, at: Date.now() };
  saveSettings();
  setState({ fastSync: on });
  schedule(LIST_DELAY);
}
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>, replace = false) {
  state = replace ? (patch as SyncState) : { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSync(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
  );
}

// ---- helpers ---------------------------------------------------------------------------------------

class SignedOutError extends Error {}

// Key-sorted JSON so equal data always compares equal regardless of insertion order.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}

function toEmail(username: string): string {
  const u = username.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@${SYNTHETIC_DOMAIN}`;
}

const AUTH_ERRORS: Record<string, string> = {
  EMAIL_EXISTS: "That username is already taken.",
  INVALID_LOGIN_CREDENTIALS: "Wrong username or password.",
  INVALID_PASSWORD: "Wrong username or password.",
  EMAIL_NOT_FOUND: "Wrong username or password.",
  USER_DISABLED: "This account has been disabled.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Try again in a few minutes.",
  INVALID_EMAIL: "That username or email isn't valid.",
  OPERATION_NOT_ALLOWED: "Username/password sign-in isn't enabled in the Firebase project.",
  CONFIGURATION_NOT_FOUND: "Username/password sign-in isn't enabled in the Firebase project.",
};

async function authCall(path: string, body: Record<string, unknown>): Promise<Record<string, string>> {
  const res = await fetch(`${AUTH_URL}/${path}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & Record<string, string>;
  if (!res.ok) {
    const code = json.error?.message ?? String(res.status);
    if (code.startsWith("WEAK_PASSWORD")) throw new Error("Password must be at least 6 characters.");
    throw new Error(AUTH_ERRORS[code.split(" ")[0]] ?? `Sign-in failed (${code}).`);
  }
  return json;
}

// ---- accounts --------------------------------------------------------------------------------------

export async function signIn(username: string, password: string, create: boolean): Promise<void> {
  if (!syncConfigured) return;
  const name = username.trim().toLowerCase();
  if (!name.includes("@") && !USERNAME.test(name)) {
    throw new Error("Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores.");
  }
  const res = await authCall(create ? "accounts:signUp" : "accounts:signInWithPassword", {
    email: toEmail(name),
    password,
    returnSecureToken: true,
  });
  auth = {
    uid: res.localId,
    username: name,
    refreshToken: res.refreshToken,
    idToken: res.idToken,
    expiresAt: Date.now() + Number(res.expiresIn ?? 3600) * 1000,
  };
  saveAuth();
  settings = loadSettings(auth.uid);
  setState({ status: "idle", account: { username: name }, fastSync: settings.fastSync }, true);
  await syncNow();
}

export async function sendPasswordReset(email: string): Promise<void> {
  await authCall("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email: email.trim().toLowerCase() });
}

export function signOut() {
  auth = null;
  saveAuth();
  settings = DEFAULT_SETTINGS;
  setState({ status: "signed-out", fastSync: settings.fastSync }, true);
}

async function idToken(): Promise<string> {
  if (!auth) throw new SignedOutError();
  if (auth.idToken && (auth.expiresAt ?? 0) > Date.now() + 60000) return auth.idToken;
  const res = await fetch(`${TOKEN_URL}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: auth.refreshToken }),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // Password changed or account removed: the user has to sign in again.
    auth = null;
    saveAuth();
    setState({ status: "error", account: undefined, error: "Please sign in again (your password may have changed).", fastSync: settings.fastSync }, true);
    throw new SignedOutError();
  }
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  const json = (await res.json()) as { id_token: string; refresh_token: string; expires_in: string };
  auth = { ...auth, idToken: json.id_token, refreshToken: json.refresh_token, expiresAt: Date.now() + Number(json.expires_in) * 1000 };
  saveAuth();
  return auth.idToken!;
}

// ---- storage (Firestore document users/{uid}) ---------------------------------------------------------

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  const call = async () => fetch(`${DB_URL}/${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await idToken()}` } });
  let res = await call();
  if (res.status === 401 && auth) {
    auth.expiresAt = 0; // force a refresh, then retry once
    res = await call();
  }
  return res;
}

async function readRemote(): Promise<Payload | null> {
  const res = await db(`users/${auth!.uid}`);
  if (res.status === 404) return null;
  if (res.status === 403) throw new Error("Firestore refused access — check the security rules (README, \"Sync\").");
  if (!res.ok) throw new Error(`Sync download failed (${res.status})`);
  const doc = (await res.json()) as { fields?: { data?: { stringValue?: string } } };
  const raw = doc.fields?.data?.stringValue;
  return raw ? (JSON.parse(raw) as Payload) : null;
}

async function writeRemote(body: string) {
  const res = await db(`users/${auth!.uid}?updateMask.fieldPaths=data&updateMask.fieldPaths=updatedAt`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { data: { stringValue: body }, updatedAt: { integerValue: String(Date.now()) } } }),
  });
  if (!res.ok) throw new Error(`Sync upload failed (${res.status})`);
}

// ---- sync ------------------------------------------------------------------------------------------

function normalizeList(l: Partial<MyListState> | undefined): MyListState {
  return { items: l?.items ?? {}, removed: l?.removed ?? {} };
}

function normalizeProgress(p: Partial<ProgressData> | undefined): ProgressData {
  return { episodes: {}, last: {}, series: {}, hidden: {}, deleted: {}, clearedAt: 0, ...p };
}

const localSnapshot = () => canonical({ myList: getMyListState(), progress: getProgressState(), settings });
let syncedSnapshot = "";
let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (!auth) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    setState({ status: "syncing", error: undefined });
    try {
      const remote = await readRemote();
      const localList = getMyListState();
      const localProgress = getProgressState();
      const list = remote ? mergeMyList(localList, normalizeList(remote.myList)) : localList;
      const progress = remote ? mergeProgress(localProgress, normalizeProgress(remote.progress)) : localProgress;
      if (canonical(list) !== canonical(localList)) replaceMyList(list);
      if (canonical(progress) !== canonical(localProgress)) replaceProgress(progress);
      const remoteSettings = remote?.settings ?? DEFAULT_SETTINGS;
      if (remoteSettings.at > settings.at) {
        settings = remoteSettings;
        saveSettings();
        setState({ fastSync: settings.fastSync });
      }

      const merged = canonical({ myList: list, progress, settings });
      const remoteNow = remote ? canonical({ myList: normalizeList(remote.myList), progress: normalizeProgress(remote.progress), settings: remoteSettings }) : null;
      if (merged !== remoteNow) await writeRemote(JSON.stringify({ v: 1, updatedAt: Date.now(), myList: list, progress, settings } satisfies Payload));
      syncedSnapshot = localSnapshot();
      setState({ status: "idle", lastSync: Date.now() });
    } catch (err) {
      if (!(err instanceof SignedOutError)) setState({ status: "error", error: navigator.onLine ? String((err as Error).message) : "Offline — will sync when you're back online." });
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer: number | undefined;
let timerDue = 0;
function schedule(delay: number) {
  if (!auth) return;
  const due = Date.now() + delay;
  if (timer !== undefined && timerDue <= due) return; // an earlier sync is already planned
  window.clearTimeout(timer);
  timerDue = due;
  timer = window.setTimeout(() => {
    timer = undefined;
    void syncNow();
  }, delay);
}

subscribeMyList(() => {
  if (localSnapshot() !== syncedSnapshot) schedule(LIST_DELAY);
});
subscribeProgress(() => schedule(timing().progress));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // Opened or switched back to: catch up with the other devices.
    if (Date.now() - (state.lastSync ?? 0) > timing().onReturn) schedule(500);
  } else if (settings.fastSync && auth && localSnapshot() !== syncedSnapshot) {
    // Leaving the app (switching devices): upload now rather than when the batch is due.
    void syncNow();
  }
});
window.addEventListener("online", () => schedule(1000));
window.setInterval(() => {
  if (document.visibilityState === "visible" && Date.now() - (state.lastSync ?? 0) >= timing().poll - 1000) schedule(0);
}, TIMING.fast.poll);
if (auth) schedule(1500);
