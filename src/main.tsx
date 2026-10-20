import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import "@fontsource-variable/inter";
import { Img } from "./components";
import { BellIcon, BookmarkIcon, CalendarIcon, DownloadIcon, GridIcon, HomeIcon, SearchIcon } from "./icons";
import { clearNotifications, markAllRead, startNotifications, useNotifications } from "./notifications";
import Home from "./pages/Home";
import Categories from "./pages/Categories";
import CategoryPage from "./pages/CategoryPage";
import Latest from "./pages/Latest";
import Search from "./pages/Search";
import MyList from "./pages/MyList";
import Downloads from "./pages/Downloads";
import PostPage from "./pages/PostPage";
import Watch from "./pages/Watch";
import Account from "./pages/Account";
import { syncConfigured, useSync } from "./sync";
import "./styles.css";
import "./player.css";
import "./franchise.css";

const NAV = [
  { to: "/", label: "Home", icon: <HomeIcon />, end: true },
  { to: "/categories", label: "Categories", icon: <GridIcon /> },
  { to: "/latest", label: "Latest", icon: <CalendarIcon /> },
  { to: "/my-list", label: "My List", icon: <BookmarkIcon /> },
  { to: "/downloads", label: "Downloads", icon: <DownloadIcon /> },
];

function ScrollToTop() {
  const { pathname } = useLocation();
  // Block body on purpose: scrollTo returns a Promise in current Chromium, and an effect must not return one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** The app's one search input. On the results page it updates them as you type. */
function SearchField() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const onResults = pathname === "/search";
  const [value, setValue] = useState(onResults ? (params.get("q") ?? "") : "");
  const [open, setOpen] = useState(false); // phones: the field is collapsed behind an icon
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!onResults) return;
    const q = value.trim();
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { replace: true }), 350);
    return () => clearTimeout(t);
  }, [value, onResults, params, navigate]);

  // Ctrl+K (or /) focuses search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => input.current?.select());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    input.current?.blur();
  };

  return (
    <>
      <button className="icon-btn search-toggle" onClick={() => setOpen(true)} aria-label="Search">
        <SearchIcon />
      </button>
      <form className={`search-field${open ? " open" : ""}`} role="search" onSubmit={submit}>
        <SearchIcon />
        <input
          ref={input}
          type="search"
          placeholder="Search anime, genre, or studio…"
          aria-label="Search anime"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && input.current?.blur()}
          onBlur={() => setOpen(false)}
          enterKeyHint="search"
        />
        <kbd aria-hidden="true">Ctrl K</kbd>
      </form>
    </>
  );
}

function Notifications() {
  const items = useNotifications();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const unread = items.some((n) => !n.read);

  useEffect(() => {
    if (!open) return;
    markAllRead();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, items]);

  return (
    <div className="notify" ref={root}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={unread ? "Notifications (new)" : "Notifications"} aria-expanded={open}>
        <BellIcon />
        {unread && <span className="notify-dot" />}
      </button>
      {open && (
        <div className="notify-panel" role="dialog" aria-label="Notifications">
          <div className="notify-head">
            <strong>New episodes</strong>
            {!!items.length && (
              <button className="linklike" onClick={clearNotifications}>
                Clear
              </button>
            )}
          </div>
          {items.length ? (
            <ul>
              {items.map((n) => (
                <li key={n.postId}>
                  <Link to={`/watch/${n.postId}`} onClick={() => setOpen(false)}>
                    <Img src={n.poster} />
                    <span>
                      <strong>{n.title}</strong>
                      <span>Episode {n.episode} is out</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="notify-empty">New episodes of airing shows in your list or Continue Watching appear here.</p>
          )}
        </div>
      )}
    </div>
  );
}

function AccountButton() {
  const sync = useSync();
  if (!syncConfigured) return null;
  const account = sync.account;
  return (
    <NavLink to="/account" className={`account-btn ${sync.status === "error" ? "has-error" : ""}`} aria-label={account ? `Account: ${account.username}` : "Sign in"}>
      {account ? <span className="avatar">{account.username[0]?.toUpperCase()}</span> : <span className="signin-pill">Sign in</span>}
      {sync.status === "syncing" && <span className="sync-dot" aria-hidden="true" />}
    </NavLink>
  );
}

function App() {
  return (
    <>
      <ScrollToTop />
      <header className="topbar">
        <Link to="/" className="brand" aria-label="KintounTV home">
          <img src="/logo.png" alt="KintounTV" width={216} height={44} />
        </Link>
        <nav className="topnav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={n.label}>
              {n.icon}
              <span className="topnav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-end">
          <SearchField />
          <Notifications />
          <AccountButton />
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/category/:id" element={<CategoryPage />} />
          <Route path="/latest" element={<Latest />} />
          <Route path="/search" element={<Search />} />
          <Route path="/my-list" element={<MyList />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/post/:id" element={<PostPage />} />
          <Route path="/watch/:id" element={<Watch />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<p className="status">Page not found.</p>} />
        </Routes>
      </main>
      <nav className="bottomnav" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.icon}
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

// A reload while fullscreen skips the player's cleanup; make sure the desktop window is restored.
window.kintounSetFullscreen?.(false).catch(() => {});
startNotifications();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
