import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Img, PageHeader, Spinner } from "../components";
import { downloadAction, expectedBytes, formatBytes, openDownloadsFolder, useDownloads, type Download } from "../downloads";
import { DownloadIcon, FolderIcon, PauseIcon, PlayIcon, TrashIcon } from "../icons";

const STATUS: Record<Download["status"], string> = {
  queued: "Waiting",
  downloading: "Downloading",
  paused: "Paused",
  done: "Downloaded",
  error: "Failed",
};

function EpisodeRow({ d }: { d: Download }) {
  const pct = d.segments ? Math.floor((d.done / d.segments) * 100) : 0;
  const active = d.status === "downloading" || d.status === "queued";
  const size = d.status === "done" ? formatBytes(d.bytes) : d.done ? `${formatBytes(d.bytes)} of ~${formatBytes(expectedBytes(d))}` : "";
  return (
    <li className={`dl-row ${d.status}`}>
      <div className="dl-row-main">
        <strong>
          Episode {d.number}
          {d.name && <span className="dl-name"> · {d.name}</span>}
        </strong>
        <span className="dl-meta">
          {[d.lang.toUpperCase(), d.height ? `${d.height}p` : `up to ${d.quality}p`, STATUS[d.status] + (d.status === "downloading" ? ` ${pct}%` : ""), size].filter(Boolean).join(" · ")}
        </span>
        {d.status === "error" && d.error && <span className="dl-error">{d.error}</span>}
        {d.status !== "done" && (
          <span className="dl-progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
      <div className="dl-actions">
        {d.status === "done" && (
          <Link className="icon-btn accent" to={`/watch/${d.postId}?ep=${encodeURIComponent(d.episodeId)}`} aria-label={`Play episode ${d.number}`}>
            <PlayIcon />
          </Link>
        )}
        {active && (
          <button className="icon-btn" onClick={() => downloadAction("pause", [d.id])} aria-label="Pause">
            <PauseIcon />
          </button>
        )}
        {(d.status === "paused" || d.status === "error") && (
          <button className="icon-btn" onClick={() => downloadAction("resume", [d.id])} aria-label={d.status === "error" ? "Try again" : "Resume"}>
            <DownloadIcon />
          </button>
        )}
        <button className="icon-btn" onClick={() => downloadAction("delete", [d.id])} aria-label={d.status === "done" ? "Delete download" : "Cancel download"}>
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}

export default function Downloads() {
  const { supported, items } = useDownloads();
  const groups = useMemo(() => {
    const byPost = new Map<string, Download[]>();
    for (const d of items) byPost.set(d.postId, [...(byPost.get(d.postId) ?? []), d]);
    return [...byPost.values()].map((list) => list.sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number)));
  }, [items]);
  const total = items.reduce((n, d) => n + d.bytes, 0);
  const active = items.filter((d) => d.status === "downloading" || d.status === "queued");
  const isDesktop = window.location.hostname === "127.0.0.1";

  return (
    <>
      <PageHeader title="Downloads">
        <p className="page-sub">
          {supported && items.length
            ? `${items.filter((d) => d.status === "done").length} of ${items.length} episodes downloaded · ${formatBytes(total)} on this device`
            : "Episodes you save play here without an internet connection."}
        </p>
      </PageHeader>

      {supported === null && <Spinner />}
      {supported === false && <p className="status">Downloads work in the KintounTV apps for Windows and Android.</p>}
      {supported && !items.length && (
        <div className="empty-state">
          <DownloadIcon />
          <p>Nothing downloaded yet. Open a title and press Download to save one episode, a few, or the whole season.</p>
          <Link className="btn primary" to="/">
            Browse
          </Link>
        </div>
      )}

      {supported && items.length > 0 && (
        <div className="dl-toolbar">
          {active.length > 0 && (
            <button className="btn" onClick={() => downloadAction("pause", active.map((d) => d.id))}>
              <PauseIcon /> Pause all
            </button>
          )}
          {items.some((d) => d.status === "paused" || d.status === "error") && (
            <button className="btn" onClick={() => downloadAction("resume", items.filter((d) => d.status === "paused" || d.status === "error").map((d) => d.id))}>
              <DownloadIcon /> Resume all
            </button>
          )}
          {isDesktop && (
            <button className="btn" onClick={openDownloadsFolder}>
              <FolderIcon /> Open folder
            </button>
          )}
        </div>
      )}

      {groups.map((list) => {
        const first = list[0];
        const done = list.filter((d) => d.status === "done").length;
        const bytes = list.reduce((n, d) => n + d.bytes, 0);
        return (
          <section key={first.postId} className="dl-group">
            <Link to={`/post/${first.postId}`} className="dl-cover">
              <Img src={first.poster} label={first.title} />
            </Link>
            <div className="dl-body">
              <div className="dl-head">
                <div>
                  <Link to={`/post/${first.postId}`}>
                    <h2>{first.title || "Untitled"}</h2>
                  </Link>
                  <p>
                    {done} of {list.length} episodes · {formatBytes(bytes)}
                  </p>
                </div>
                <button
                  className="btn ghost"
                  onClick={() => {
                    if (window.confirm(`Delete all ${list.length} downloaded episodes of ${first.title}?`)) downloadAction("delete", list.map((d) => d.id));
                  }}
                >
                  <TrashIcon /> Delete all
                </button>
              </div>
              <ul className="dl-list">
                {list.map((d) => (
                  <EpisodeRow key={d.id} d={d} />
                ))}
              </ul>
            </div>
          </section>
        );
      })}
    </>
  );
}
