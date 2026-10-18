import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, watchApi, type Episode, type Server } from "../api";
import { Spinner, Status } from "../components";
import { useAsync } from "../hooks";
import { BackIcon, NextIcon, PrevIcon } from "../icons";
import Player from "../Player";
import { getProgress, saveProgress, setPlayerPrefs, setSeriesInfo, usePlayerPrefs, useProgress, type EpisodeRef } from "../progress";

const RANGE_SIZE = 100;

function episodeLabel(ep: Episode) {
  return ep.name && ep.name !== `Episode ${ep.number}` ? `Episode ${ep.number}: ${ep.name}` : `Episode ${ep.number}`;
}

const toRef = (ep: Episode): EpisodeRef => ({ id: ep.id, number: ep.number, name: ep.name });

function pickServer(servers: Server[], lang: string, failed: Set<number>): number {
  const order = servers.map((s, i) => ({ s, i })).filter(({ i }) => !failed.has(i));
  const preferred = order.find(({ s }) => s.lang === lang) ?? order[0];
  return preferred ? preferred.i : -1;
}

export default function Watch() {
  const postId = Number(useParams().id);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const prefs = usePlayerPrefs();
  const progress = useProgress();
  const post = useAsync(() => api.post(postId), [postId]);
  const episodes = useAsync(() => watchApi.episodes(postId), [postId]);
  const list = episodes.data ?? [];

  useEffect(() => {
    if (post.data) setSeriesInfo(postId, { title: post.data.title, poster: post.data.poster });
  }, [postId, post.data]);

  const requestedEp = params.get("ep") ?? progress.last[postId]?.ep;
  const index = Math.max(0, list.findIndex((e) => e.id === requestedEp));
  const episode: Episode | undefined = list[index];

  const servers = useAsync(() => (episode ? watchApi.servers(postId, episode.id) : Promise.resolve([])), [postId, episode?.id]);
  const [chosenServer, setChosenServer] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setChosenServer(null);
    setFailed(new Set());
    setPlayerError(null);
  }, [episode?.id]);

  const serverList = servers.data ?? [];
  const serverIndex = chosenServer ?? pickServer(serverList, prefs.lang, failed);
  const server: Server | undefined = serverList[serverIndex];

  const source = useAsync(
    () => (server ? watchApi.source(postId, server.id) : Promise.resolve(null)),
    [postId, server?.id, serverIndex, attempt],
  );

  // Resume where this episode was left. Read when the player is (re)created (episode, server or
  // retry), not on every saved tick, so saving progress never reloads the stream.
  const startAt = useMemo(() => {
    const p = episode && getProgress(postId, episode.id);
    return p && p.t > 10 && (!p.d || p.t < p.d - 30) ? p.t : 0;
  }, [postId, episode?.id, serverIndex, attempt]);

  const prev = index > 0 ? list[index - 1] : undefined;
  const next = index < list.length - 1 ? list[index + 1] : undefined;
  const nextRef: EpisodeRef | undefined = next && toRef(next);

  // Save the exact position before the stream is swapped, so a server change continues from it.
  const snapshot = useCallback(() => {
    const video = document.querySelector<HTMLVideoElement>(".player-video");
    if (episode && video && video.currentTime > 0) saveProgress(postId, toRef(episode), video.currentTime, video.duration || 0, nextRef);
  }, [postId, episode, nextRef]);

  const goTo = useCallback(
    (ep: Episode | undefined) => {
      if (!ep) return;
      snapshot(); // keep the exact position of the episode being left
      setParams({ ep: ep.id }, { replace: true });
    },
    [setParams, snapshot],
  );

  const failOver = useCallback(
    (message: string) => {
      snapshot();
      const nextFailed = new Set(failed).add(serverIndex);
      const alternative = pickServer(serverList, prefs.lang, nextFailed);
      setFailed(nextFailed);
      if (alternative >= 0 && chosenServer === null) {
        setPlayerError(null);
      } else {
        setPlayerError(message);
      }
    },
    [failed, serverIndex, serverList, prefs.lang, chosenServer, snapshot],
  );

  // A server that fails to produce a link is skipped automatically, like a playback failure.
  useEffect(() => {
    if (source.error && server) failOver(source.error);
  }, [source.error]);

  const title = post.data?.title ?? "";
  const loadingPlayer = episodes.loading || servers.loading || source.loading;
  const exhausted = !loadingPlayer && serverList.length > 0 && serverIndex < 0;

  // Loading and error states render inside the one Player instance, which stays mounted across
  // episodes and servers so fullscreen survives "Next" and auto-next.
  let overlay: React.ReactNode = null;
  if (episodes.error) overlay = <Status message={episodes.error} onRetry={episodes.reload} />;
  else if (!episodes.loading && list.length === 0) overlay = <Status message="No episodes are available for this title yet." />;
  else if (servers.error) overlay = <Status message={servers.error} onRetry={servers.reload} />;
  else if (!servers.loading && episode && serverList.length === 0) overlay = <Status message="No servers for this episode yet." />;
  else if (playerError || exhausted)
    overlay = (
      <Status
        message={playerError ?? "None of the servers could play this episode."}
        onRetry={() => {
          setFailed(new Set());
          setPlayerError(null);
          setAttempt((a) => a + 1);
        }}
      />
    );
  else if (loadingPlayer || !source.data) overlay = <Spinner />;
  // A retry must reload even if the server hands back the same link (the relay ignores extra params).
  const src = overlay || !source.data ? null : attempt ? `${source.data}&retry=${attempt}` : source.data;

  // AniSkip numbers episodes per season; AniLab continues numbering across seasons (S2 may start at 171).
  const firstNumber = Number(list[0]?.number);
  const relEpisode = episode ? (Number.isFinite(firstNumber) && Number.isFinite(Number(episode.number)) ? Number(episode.number) - firstNumber + 1 : index + 1) : 0;
  const skip = post.data && episode ? { postId, title: post.data.title, type: post.data.type, premiered: post.data.premiered, episode: relEpisode } : null;

  const stage = (
    <Player
      src={src}
      overlay={overlay}
      skip={skip}
      startAt={startAt}
      title={title}
      subtitle={episode && episodeLabel(episode)}
      lang={server?.lang}
      onProgress={(t, d, thumb) => episode && saveProgress(postId, toRef(episode), t, d, nextRef, thumb)}
      onEnded={() => prefs.autoNext && goTo(next)}
      onNext={next && (() => goTo(next))}
      onPrev={prev && (() => goTo(prev))}
      onFatalError={failOver}
    />
  );

  return (
    <div className="watch">
      <div className="page-title with-back watch-title">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <BackIcon />
        </button>
        <div>
          <h1>{title}</h1>
          {episode && <p className="watch-sub">{episodeLabel(episode)}</p>}
        </div>
      </div>

      <div className="player-stage">{stage}</div>

      <div className="player-bar">
        <div className="player-nav">
          <button className="btn" onClick={() => goTo(prev)} disabled={!prev} aria-label="Previous episode">
            <PrevIcon /> Prev
          </button>
          <button className="btn" onClick={() => goTo(next)} disabled={!next} aria-label="Next episode">
            Next <NextIcon />
          </button>
        </div>
        <div className="server-list" role="radiogroup" aria-label="Server">
          {serverList.map((s, i) => (
            <button
              key={`${s.id}-${i}`}
              role="radio"
              aria-checked={i === serverIndex}
              className={`chip ${i === serverIndex ? "active" : ""} ${failed.has(i) ? "failed" : ""}`}
              onClick={() => {
                const retrying = i === serverIndex;
                if (retrying && !playerError && !failed.has(i)) return;
                snapshot();
                setChosenServer(i);
                if (retrying) setAttempt((a) => a + 1);
                setPlayerError(null);
                setFailed((f) => {
                  const copy = new Set(f);
                  copy.delete(i);
                  return copy;
                });
                setPlayerPrefs({ lang: s.lang });
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="toggles">
          <label className="toggle" title="Skip intros, recaps and credits automatically when timings are known (otherwise a Skip button is shown)">
            <input type="checkbox" checked={prefs.autoSkip} onChange={(e) => setPlayerPrefs({ autoSkip: e.target.checked })} />
            Auto-skip intro
          </label>
          <label className="toggle">
            <input type="checkbox" checked={prefs.autoNext} onChange={(e) => setPlayerPrefs({ autoNext: e.target.checked })} />
            Auto-next
          </label>
        </div>
      </div>

      {list.length > 0 && <EpisodeBrowser postId={postId} list={list} current={episode} onPick={goTo} progress={progress.episodes} />}
    </div>
  );
}

interface EpisodeBrowserProps {
  postId: number;
  list: Episode[];
  current: Episode | undefined;
  onPick: (ep: Episode) => void;
  progress: Record<string, { t: number; d: number }>;
}

function EpisodeBrowser({ postId, list, current, onPick, progress }: EpisodeBrowserProps) {
  const prefs = usePlayerPrefs();
  const [query, setQuery] = useState("");
  const ranges = useMemo(() => {
    const out: { from: number; to: number; label: string }[] = [];
    for (let i = 0; i < list.length; i += RANGE_SIZE) {
      const to = Math.min(i + RANGE_SIZE, list.length) - 1;
      out.push({ from: i, to, label: `${list[i].number}–${list[to].number}` });
    }
    return out;
  }, [list]);
  const currentIndex = current ? list.indexOf(current) : 0;
  const [range, setRange] = useState(Math.floor(currentIndex / RANGE_SIZE));
  useEffect(() => setRange(Math.floor(currentIndex / RANGE_SIZE)), [currentIndex]);

  const q = query.trim().toLowerCase();
  let shown = q
    ? list.filter((e) => e.number === q || e.number.startsWith(q) || e.name.toLowerCase().includes(q)).slice(0, 200)
    : list.slice(ranges[range]?.from ?? 0, (ranges[range]?.to ?? -1) + 1);
  if (prefs.descending) shown = [...shown].reverse();

  return (
    <section className="episodes">
      <div className="episodes-head">
        <h2 className="row-title">Episodes · {list.length}</h2>
        <input className="episode-filter" type="search" placeholder="Go to episode…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="chip" onClick={() => setPlayerPrefs({ descending: !prefs.descending })}>
          {prefs.descending ? "Newest first" : "Oldest first"}
        </button>
      </div>
      {!q && ranges.length > 1 && (
        <div className="range-list">
          {(prefs.descending ? [...ranges].reverse() : ranges).map((r) => {
            const i = ranges.indexOf(r);
            return (
              <button key={r.label} className={`chip ${i === range ? "active" : ""}`} onClick={() => setRange(i)}>
                {r.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="episode-grid">
        {shown.map((ep) => {
          const p = progress[`${postId}:${ep.id}`];
          const pct = p && p.d ? Math.min(100, (p.t / p.d) * 100) : 0;
          return (
            <button
              key={ep.id}
              className={`episode ${ep.id === current?.id ? "current" : ""} ${pct > 90 ? "watched" : ""}`}
              onClick={() => onPick(ep)}
              title={episodeLabel(ep)}
            >
              <span className="episode-number">{ep.number}</span>
              {ep.filler && <span className="filler">Filler</span>}
              {pct > 0 && <span className="episode-progress" style={{ width: `${pct}%` }} />}
            </button>
          );
        })}
        {q && shown.length === 0 && <p className="status">No episode matches “{query}”.</p>}
      </div>
    </section>
  );
}
