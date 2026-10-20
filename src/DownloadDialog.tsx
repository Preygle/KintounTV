// Choose episodes to download: one, several, or the whole season, in SUB or DUB and a quality cap.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Episode } from "./api";
import { CheckIcon, CloseIcon, DownloadIcon } from "./icons";
import { addDownloads, QUALITIES, useDownloads } from "./downloads";
import { usePlayerPrefs } from "./progress";

const RANGE_SIZE = 100;
const QUALITY_KEY = "kintoun.downloadQuality";

function savedQuality(): number {
  try {
    const q = Number(localStorage.getItem(QUALITY_KEY));
    return QUALITIES.includes(q) ? q : 720;
  } catch {
    return 720;
  }
}

interface Props {
  postId: number;
  title: string;
  poster: string;
  episodes: Episode[];
  initial?: string[]; // episode ids selected when the dialog opens
  onClose: () => void;
}

export default function DownloadDialog({ postId, title, poster, episodes, initial = [], onClose }: Props) {
  const prefs = usePlayerPrefs();
  const { items } = useDownloads();
  const [lang, setLang] = useState<"sub" | "dub">(prefs.lang === "dub" ? "dub" : "sub");
  const [quality, setQuality] = useState(savedQuality);
  const [selected, setSelected] = useState(() => new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);

  // Episodes already saved or queued in this language can't be picked again.
  const have = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of items) if (d.postId === String(postId) && d.lang === lang) m.set(d.episodeId, d.status);
    return m;
  }, [items, postId, lang]);
  const pickable = episodes.filter((e) => !have.has(e.id));
  const chosen = pickable.filter((e) => selected.has(e.id));

  const ranges = useMemo(() => {
    const out: { from: number; to: number; label: string }[] = [];
    for (let i = 0; i < episodes.length; i += RANGE_SIZE) {
      const to = Math.min(i + RANGE_SIZE, episodes.length) - 1;
      out.push({ from: i, to, label: `${episodes[i].number}–${episodes[to].number}` });
    }
    return out;
  }, [episodes]);
  const firstSelected = Math.max(0, episodes.findIndex((e) => selected.has(e.id)));
  const [range, setRange] = useState(Math.floor(firstSelected / RANGE_SIZE));
  const shown = episodes.slice(ranges[range]?.from ?? 0, (ranges[range]?.to ?? -1) + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const selectAll = (eps: Episode[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const e of eps) on ? next.add(e.id) : next.delete(e.id);
      return next;
    });

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(QUALITY_KEY, String(quality));
    } catch {
      // only a convenience
    }
    try {
      await addDownloads({ postId, title, poster, lang, quality, episodes: chosen });
      setAdded(chosen.length);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal download-dialog" role="dialog" aria-modal="true" aria-label={`Download ${title}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Download</h2>
            <p>{title}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {added > 0 ? (
          <div className="download-added">
            <span className="download-added-icon">
              <CheckIcon />
            </span>
            <p>
              {added === 1 ? "1 episode" : `${added} episodes`} added to Downloads. They download one after another while the app is open.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setAdded(0)}>
                Pick more
              </button>
              <Link className="btn primary" to="/downloads" onClick={onClose}>
                Go to Downloads
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="download-options">
              <div className="segmented" role="radiogroup" aria-label="Language">
                {(["sub", "dub"] as const).map((l) => (
                  <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? "active" : ""} onClick={() => setLang(l)}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
              <label className="select">
                <span className="visually-hidden">Quality</span>
                <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
                  {QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      Up to {q}p
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="download-select">
              <span>
                {chosen.length} of {pickable.length} selected
              </span>
              <button className="chip" onClick={() => selectAll(pickable, true)} disabled={!pickable.length}>
                {episodes.length > 1 ? "Entire season" : "Select"}
              </button>
              {ranges.length > 1 && (
                <button className="chip" onClick={() => selectAll(shown.filter((e) => !have.has(e.id)), true)}>
                  All of {ranges[range]?.label}
                </button>
              )}
              <button className="chip" onClick={() => setSelected(new Set())} disabled={!chosen.length}>
                Clear
              </button>
            </div>

            {ranges.length > 1 && (
              <div className="range-list">
                {ranges.map((r, i) => (
                  <button key={r.label} className={`chip ${i === range ? "active" : ""}`} onClick={() => setRange(i)}>
                    {r.label}
                  </button>
                ))}
              </div>
            )}

            <div className="episode-grid download-grid">
              {shown.map((ep) => {
                const status = have.get(ep.id);
                const on = selected.has(ep.id) && !status;
                return (
                  <button
                    key={ep.id}
                    className={`episode ${on ? "current" : ""} ${status ? "saved" : ""}`}
                    onClick={() => !status && toggle(ep.id)}
                    disabled={!!status}
                    aria-pressed={on}
                    title={status ? (status === "done" ? "Downloaded" : "In Downloads") : `Episode ${ep.number}`}
                  >
                    <span className="episode-number">{ep.number}</span>
                    {status && <span className="episode-saved">{status === "done" ? <CheckIcon /> : <DownloadIcon />}</span>}
                  </button>
                );
              })}
            </div>

            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={start} disabled={!chosen.length || busy}>
                <DownloadIcon /> {chosen.length > 1 ? `Download ${chosen.length} episodes` : "Download episode"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
