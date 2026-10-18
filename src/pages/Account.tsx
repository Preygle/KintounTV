import { useEffect, useState } from "react";
import { PageHeader } from "../components";
import { sendPasswordReset, signIn, signOut, syncConfigured, syncNow, useSync } from "../sync";

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
            <p className="account-note">Signing out keeps everything on this device; sign in again any time to resume syncing. Thumbnails stay on each device.</p>
          </div>
        ) : (
          <SignInForm />
        )}
      </section>
    </>
  );
}
