import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { BookmarkIcon, ClockIcon, GridIcon, HomeIcon, SearchIcon } from "./icons";
import Home from "./pages/Home";
import Categories from "./pages/Categories";
import CategoryPage from "./pages/CategoryPage";
import Latest from "./pages/Latest";
import Search from "./pages/Search";
import MyList from "./pages/MyList";
import PostPage from "./pages/PostPage";
import Watch from "./pages/Watch";
import Account from "./pages/Account";
import { syncConfigured, useSync } from "./sync";
import "./styles.css";
import "./player.css";

const NAV = [
  { to: "/", label: "Home", icon: <HomeIcon />, end: true },
  { to: "/categories", label: "Categories", icon: <GridIcon /> },
  { to: "/latest", label: "Latest", icon: <ClockIcon /> },
  { to: "/search", label: "Search", icon: <SearchIcon /> },
  { to: "/my-list", label: "My List", icon: <BookmarkIcon /> },
];

function ScrollToTop() {
  const { pathname } = useLocation();
  // Block body on purpose: scrollTo returns a Promise in current Chromium, and an effect must not return one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AccountButton() {
  const sync = useSync();
  if (!syncConfigured) return null;
  const account = sync.account;
  return (
    <NavLink to="/account" className={`account-btn ${sync.status === "error" ? "has-error" : ""}`} aria-label={account ? `Account: ${account.username}` : "Sign in"}>
      {account ? (
        <span className="avatar">{account.username[0]?.toUpperCase()}</span>
      ) : (
        <span className="signin-pill">Sign in</span>
      )}
      {sync.status === "syncing" && <span className="sync-dot" aria-hidden="true" />}
    </NavLink>
  );
}

function App() {
  return (
    <>
      <ScrollToTop />
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          KintounTV
        </Link>
        <nav className="topnav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <AccountButton />
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/category/:id" element={<CategoryPage />} />
          <Route path="/latest" element={<Latest />} />
          <Route path="/search" element={<Search />} />
          <Route path="/my-list" element={<MyList />} />
          <Route path="/post/:id" element={<PostPage />} />
          <Route path="/watch/:id" element={<Watch />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<p className="status">Page not found.</p>} />
        </Routes>
      </main>
      <nav className="bottomnav">
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
