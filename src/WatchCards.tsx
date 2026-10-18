// Crunchyroll-style landscape episode cards: Continue Watching (home) and History (My List tab).
import { useState } from "react";
import { Link } from "react-router-dom";
import { CloseIcon, PlayIcon } from "./icons";
import { clearHistory, continueItems, hideFromContinue, historyItems, removeHistoryEntry, useProgress, WATCHED_RATIO } from "./progress";

function timeLeft(t: number, d: number) {
  const left = Math.max(0, d - t);
  if (left < 60) return "Less than 1m left";
  const m = Math.round(left / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
}

interface EpisodeCardProps {
  to: string;
  title: string;
  episodeLine: string;
  thumb?: string;
  poster?: string;
  t: number;
  d: number;
  badge?: string;
  onRemove: () => void;
  removeLabel: string;
}

function EpisodeCard({ to, title, episodeLine, thumb, poster, t, d, badge, onRemove, removeLabel }: EpisodeCardProps) {
  const pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;
  const watched = d > 0 && t / d >= WATCHED_RATIO;
  return (
    <div className="ep-card">
      <Link to={to} className="ep-card-media">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        ) : poster ? (
          <>
            <img className="ep-card-blur" src={poster} alt="" loading="lazy" decoding="async" />
            <img className="ep-card-poster" src={poster} alt="" loading="lazy" decoding="async" />
          </>
        ) : null}
        <span className="ep-card-play">
          <PlayIcon />
        </span>
        {badge && <span className="ep-card-badge">{badge}</span>}
        {d > 0 && <span className="ep-card-left">{watched ? "Watched" : timeLeft(t, d)}</span>}
        {pct > 0 && (
          <span className="ep-card-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </Link>
      <button className="ep-card-remove" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
        <CloseIcon />
      </button>
      <Link to={to} className="ep-card-text">
        <strong>{title}</strong>
        <span>{episodeLine}</span>
      </Link>
    </div>
  );
}

const epLine = (number: string, name?: string) => (name && name !== `Episode ${number}` ? `E${number} · ${name}` : `Episode ${number}`);

export function ContinueWatchingRow() {
  const items = continueItems(useProgress()).slice(0, 20);
  if (!items.length) return null;
  return (
    <section className="row continue-row">
      <div className="row-head">
        <h2 className="row-title">Continue Watching</h2>
        <Link to="/my-list?tab=history" className="row-link">
          View History
        </Link>
      </div>
      <div className="row-scroller ep-scroller">
        {items.map((it) => (
          <EpisodeCard
            key={it.postId}
            to={`/watch/${it.postId}?ep=${encodeURIComponent(it.episode.id)}`}
            title={it.title}
            episodeLine={it.upNext ? `Up next · ${epLine(it.episode.number, it.episode.name)}` : epLine(it.episode.number, it.episode.name)}
            thumb={it.thumb}
            poster={it.poster}
            t={it.t}
            d={it.d}
            badge={it.upNext ? "Up next" : undefined}
            onRemove={() => hideFromContinue(it.postId)}
            removeLabel="Remove from Continue Watching"
          />
        ))}
      </div>
    </section>
  );
}

function dayGroup(at: number) {
  const day = 86400000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (at >= startOfToday) return "Today";
  if (at >= startOfToday - day) return "Yesterday";
  if (at >= startOfToday - 6 * day) return "This week";
  return "Earlier";
}

export function HistoryGrid() {
  const items = historyItems(useProgress());
  const [confirming, setConfirming] = useState(false);
  if (!items.length) return <p className="status">Nothing watched yet. Episodes you play show up here.</p>;

  const groups: { label: string; items: typeof items }[] = [];
  for (const it of items) {
    const label = dayGroup(it.at);
    if (groups[groups.length - 1]?.label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(it);
  }

  return (
    <div className="history">
      <div className="history-actions">
        <span>{items.length} episodes</span>
        {confirming ? (
          <>
            <button
              className="btn danger"
              onClick={() => {
                clearHistory();
                setConfirming(false);
              }}
            >
              Clear all history
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirming(true)}>
            Clear history
          </button>
        )}
      </div>
      {groups.map((g) => (
        <section key={g.label} className="history-group">
          <h2 className="row-title">{g.label}</h2>
          <div className="ep-grid">
            {g.items.map((it) => (
              <EpisodeCard
                key={`${it.postId}:${it.episodeId}`}
                to={`/watch/${it.postId}?ep=${encodeURIComponent(it.episodeId)}`}
                title={it.title}
                episodeLine={epLine(it.n ?? "", it.name)}
                thumb={it.thumb}
                poster={it.poster}
                t={it.t}
                d={it.d}
                onRemove={() => removeHistoryEntry(it.postId, it.episodeId)}
                removeLabel="Remove from history"
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
