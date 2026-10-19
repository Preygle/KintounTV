// Landscape (16:9) episode cards: Continue Watching (home) and History (My List tab).
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useBanner, useEpisodeCount } from "./catalog";
import { Img, Row } from "./components";
import { ClockIcon, CloseIcon, PlayIcon } from "./icons";
import { clearHistory, continueItems, hideFromContinue, historyItems, removeHistoryEntry, useProgress, WATCHED_RATIO } from "./progress";

function timeLeft(t: number, d: number) {
  const left = Math.max(0, d - t);
  if (left < 60) return "<1m left";
  const m = Math.round(left / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
}

interface EpisodeCardProps {
  postId: number;
  to: string;
  title: string;
  number: string;
  name?: string;
  thumb?: string;
  poster?: string;
  t: number;
  d: number;
  upNext?: boolean;
  onRemove: () => void;
  removeLabel: string;
}

function EpisodeCard({ postId, to, title, number, name, thumb, poster, t, d, upNext, onRemove, removeLabel }: EpisodeCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const total = useEpisodeCount(postId, ref);
  // Without a captured frame, the title's wide artwork stands in (a cropped poster as last resort).
  const banner = useBanner(postId, title, !thumb);
  const pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;
  const watched = d > 0 && t / d >= WATCHED_RATIO;
  const n = Number(number);
  // Sequels can continue the numbering (season 2 starting at 26), so only show a total that fits.
  const episodeLine = `Episode ${number}${total && n <= total ? ` / ${total}` : ""}`;
  return (
    <div className="ep-card" ref={ref}>
      <Link to={to} className="ep-card-media" aria-label={`${upNext ? "Play" : "Resume"} ${title}, ${episodeLine}`}>
        {thumb || banner ? <Img src={thumb ?? banner} /> : <Img className="ep-card-poster" src={poster} label={title} />}
        <span className="ep-card-play">
          <PlayIcon />
        </span>
        {upNext && <span className="ep-card-tag">Up next</span>}
        {d > 0 && <span className="ep-card-left">{watched ? "Watched" : timeLeft(t, d)}</span>}
        {pct > 0 && (
          <span className="ep-card-bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </Link>
      <button className="ep-card-remove" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
        <CloseIcon />
      </button>
      <Link to={to} className="ep-card-text" tabIndex={-1}>
        <span className="ep-card-title">{title}</span>
        <span className="ep-card-line">
          <span className="ep-card-ep" title={name}>
            {episodeLine}
            {name && name !== `Episode ${number}` && <span className="ep-card-name"> · {name}</span>}
          </span>
          {pct > 0 && <span className="ep-card-pct">{Math.round(pct)}%</span>}
        </span>
      </Link>
    </div>
  );
}

export function ContinueWatchingRow() {
  const items = continueItems(useProgress()).slice(0, 20);
  if (!items.length) return null;
  return (
    <Row
      title="Continue Watching"
      icon={<ClockIcon />}
      className="continue-row"
      action={
        <Link to="/my-list?tab=history" className="row-link">
          View History
        </Link>
      }
    >
      {items.map((it) => (
        <EpisodeCard
          key={it.postId}
          postId={it.postId}
          to={`/watch/${it.postId}?ep=${encodeURIComponent(it.episode.id)}`}
          title={it.title}
          number={it.episode.number}
          name={it.episode.name}
          thumb={it.thumb}
          poster={it.poster}
          t={it.t}
          d={it.d}
          upNext={it.upNext}
          onRemove={() => hideFromContinue(it.postId)}
          removeLabel="Remove from Continue Watching"
        />
      ))}
    </Row>
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
          <h2 className="section-title">{g.label}</h2>
          <div className="ep-grid">
            {g.items.map((it) => (
              <EpisodeCard
                key={`${it.postId}:${it.episodeId}`}
                postId={it.postId}
                to={`/watch/${it.postId}?ep=${encodeURIComponent(it.episodeId)}`}
                title={it.title}
                number={it.n ?? ""}
                name={it.name}
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
