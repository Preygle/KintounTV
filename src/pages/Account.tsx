import { useEffect, useState } from "react";
import { PageHeader } from "../components";
import { sendPasswordReset, setFastSync, signIn, signOut, syncConfigured, syncNow, useSync } from "../sync";
import { APP_VERSION, checkForUpdate, installLabel, installUpdate, isNewer, RELEASES_PAGE, useUpdates } from "../updates";

function ago(t?: number) {
  if (!t) return "not yet";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleString();
}

function SignInForm() {
  const sync = useSync();
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "create" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await signIn(username, password, mode === "create");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError(null);
    setNotice(null);
    try {
      await sendPasswordReset(username);
      setNotice(`Password reset email sent to ${username.trim()}.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="account-card" onSubmit={submit}>
      <h2>Sync across your devices</h2>
      <p className="account-lead">Sign in to keep My List and your watch history the same on your PC and phone.</p>
      <nav className="tabs compact" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
          Create account
        </button>
      </nav>
      {sync.status === "error" && sync.error && !error && <p className="sync-line error">{sync.error}</p>}
      <label className="field">
        <span>Username</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "create" ? "new-password" : "current-password"} required minLength={6} />
      </label>
      {mode === "create" && (
        <label className="field">
          <span>Confirm password</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={6} />
        </label>
      )}
      {error && <p className="sync-line error">{error}</p>}
      {notice && <p className="sync-line">{notice}</p>}
      <div className="actions left">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "create" ? "Create account" : "Sign in"}
        </button>
        {mode === "signin" && username.includes("@") && (
          <button className="btn" type="button" onClick={() => void forgot()}>
            Forgot password?
          </button>
        )}
      </div>
      <p className="account-note">
        Use the same username and password on every device. Tip: use your email address as the username if you want to be able to reset a forgotten password.
      </p>
    </form>
  );
}

/** The installed version, update check and in-app update. */
function AppCard() {
  const u = useUpdates();
  const newer = isNewer(u.latest) ? u.latest : null;
  const busy = installLabel(u.install);
  // The release notes' first lines (Markdown bullets), shown as plain text.
  const notes = (newer?.notes ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("|") && !/^sha|^`/i.test(l))
    .slice(0, 6);
  return (
    <div className="account-card" id="updates">
      <h2>App</h2>
      <p className="sync-line">
        KintounTV {APP_VERSION}
        {newer ? ` · version ${newer.version} is available` : u.checkedAt ? ` · up to date (checked ${ago(u.checkedAt)})` : ""}
      </p>
      {newer && notes.length > 0 && (
        <ul className="update-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {busy && <p className="sync-line">{busy}</p>}
      {u.install.state === "error" && <p className="sync-line error">{u.install.error}</p>}
      {u.checkError && <p className="sync-line error">{u.checkError}</p>}
      <div className="actions left">
        {newer && u.installable && (
          <button className="btn primary" onClick={() => void installUpdate()} disabled={!!busy}>
            Update to {newer.version}
          </button>
        )}
        {newer && u.installable === false && (
          <a className="btn primary" href={RELEASES_PAGE} target="_blank" rel="noreferrer">
            Download {newer.version}
          </a>
        )}
        <button className="btn" onClick={() => void checkForUpdate()} disabled={u.checking || !!busy}>
          {u.checking ? "Checking…" : "Check for updates"}
        </button>
      </div>
      {u.installable && (
        <p className="account-note">
          {u.install.platform === "android"
            ? "Updates are downloaded from the official GitHub release and checked before Android asks you to confirm. The first time, Android asks you to allow installs from KintounTV."
            : "Updates are downloaded from the official GitHub release, checked, and installed in place; the app restarts on the new version. Your list, history and sign-in stay."}
        </p>
      )}
    </div>
  );
}

export default function Account() {
  const sync = useSync();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 15000);
    return () => window.clearInterval(t);
  }, []);

  if (!syncConfigured) {
    return (
      <>
        <PageHeader title="Account" />
        <p className="status">Sync isn't set up in this build (missing Firebase config — see README, "Sync").</p>
        <section className="account">
          <AppCard />
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Account" />
      <section className="account">
        {sync.account ? (
          <div className="account-card">
            <div className="account-who">
              <span className="avatar large">{sync.account.username[0]?.toUpperCase()}</span>
              <div>
                <strong>{sync.account.username}</strong>
                <span>Signed in on this device</span>
              </div>
            </div>
            <p className={`sync-line ${sync.status === "error" ? "error" : ""}`}>
              {sync.status === "syncing" ? "Syncing…" : sync.status === "error" ? sync.error : `My List and watch history synced ${ago(sync.lastSync)}`}
            </p>
            <div className="actions left">
              <button className="btn primary" onClick={() => void syncNow()} disabled={sync.status === "syncing"}>
                Sync now
              </button>
              <button className="btn" onClick={signOut}>
                Sign out
              </button>
            </div>
            <label className="sync-option">
              <input type="checkbox" checked={sync.fastSync} onChange={(e) => setFastSync(e.target.checked)} />
              <span>
                <strong>Fast sync</strong>
                {sync.fastSync
                  ? "Switching between devices picks up within about 30 seconds of where you stopped. Applies to every device signed in to this account."
                  : "Watch progress syncs every minute and other devices are checked every 5 minutes, using fewer requests. Applies to every device signed in to this account."}
              </span>
            </label>
            <p className="account-note">Signing out keeps everything on this device; sign in again any time to resume syncing. Thumbnails stay on each device.</p>
          </div>
        ) : (
          <SignInForm />
        )}
        <AppCard />
      </section>
    </>
  );
}
