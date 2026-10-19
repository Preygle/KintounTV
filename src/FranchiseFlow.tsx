// "Watch order" on the details page: the franchise as a flow chart. Steps of the main line run left
// to right (top to bottom on phones); movies, OVAs, recaps and spin-offs branch off below the step
// they belong to.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { PostDetail } from "./api";
import { useEpisodeCount } from "./catalog";
import { crawlFranchise, isSeries, layoutFranchise, type Extra, type FranchiseNode, type Step } from "./franchise";
import { useProgress } from "./progress";

const GRAPH_TTL_MS = 10 * 60 * 1000;
const EXTRAS_SHOWN = 4;
const EXTRAS_SHOWN_SOLO = 8;

const LABELS: Record<string, string> = {
  "Side Story": "Side story",
  Summary: "Recap",
  "Full Story": "Full story",
  "Parent Story": "Main story",
  "Alternative Version": "Alt. version",
  "Alternative Setting": "Alt. setting",
  Character: "Crossover",
  Other: "Related",
};

// Graphs crawled recently: opening another title of the same franchise reuses its graph.
const graphs: { at: number; ids: Set<number>; nodes: Promise<Map<number, FranchiseNode>> }[] = [];

function franchiseOf(post: PostDetail): Promise<Map<number, FranchiseNode>> {
  const now = Date.now();
  const hit = graphs.find((g) => now - g.at < GRAPH_TTL_MS && g.ids.has(post.id));
  if (hit) return hit.nodes;
  const entry = { at: now, ids: new Set([post.id]), nodes: crawlFranchise(post) };
  entry.nodes.then((nodes) => nodes.forEach((_, id) => entry.ids.add(id)));
  graphs.unshift(entry);
  graphs.length = Math.min(graphs.length, 8);
  return entry.nodes;
}

function formatClass(node: FranchiseNode): string {
  const t = (node.type ?? "").toLowerCase();
  if (isSeries(node)) return t;
  if (t === "movie" || t === "ova") return t;
  return t.includes("special") ? "special" : "other";
}

function runtimeText(runtime: string | null): string | null {
  const m = /(\d+)\s*m/i.exec(runtime ?? "");
  if (!m) return runtime;
  const min = Number(m[1]);
  if (min < 60) return `${min}m`;
  return min % 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min / 60}h`;
}

function metaParts(node: FranchiseNode, episodes: number | null, yearOnly = false): string[] {
  const parts: string[] = [];
  if (node.type === "Movie") {
    const rt = runtimeText(node.runtime);
    if (rt) parts.push(rt);
  } else if (episodes) {
    parts.push(`${episodes} ${episodes === 1 ? "ep" : "eps"}`);
  }
  if (node.premiered) parts.push(yearOnly ? node.premiered.replace(/^\D+/, "") : node.premiered);
  return parts;
}

/** Drops a franchise name the title repeats: "Dragon Ball Z: Dead Zone" under Dragon Ball Z. */
function shortTitle(title: string, bases: string[]): string {
  const lower = title.toLowerCase();
  for (const base of bases) {
    if (!lower.startsWith(base.toLowerCase())) continue;
    const rest = /^\s*[:\-–]\s*(.+)$/.exec(title.slice(base.length));
    if (rest) return rest[1];
  }
  return title;
}

function StatusChip({ status }: { status: string | null }) {
  if (status === "Currently Airing") return <span className="flow-status airing">Airing</span>;
  if (status === "Not yet aired") return <span className="flow-status">Upcoming</span>;
  return null;
}

function MainTile({ node, current }: { node: FranchiseNode; current: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const episodes = useEpisodeCount(node.id, ref, node.loaded && node.type !== "Movie");
  const resume = useProgress().last[node.id];
  return (
    <Link ref={ref} to={`/post/${node.id}`} className={`flow-tile${current ? " current" : ""}`} aria-current={current ? "page" : undefined}>
      <div className="flow-art">
        {node.poster && <img src={node.poster} alt="" loading="lazy" decoding="async" />}
        {node.type && <span className={`fmt ${formatClass(node)}`}>{node.type}</span>}
        <StatusChip status={node.status} />
        {current ? <span className="flow-here">You're here</span> : resume && <span className="flow-here resume">Ep {resume.number}</span>}
      </div>
      <div className="flow-info">
        <span className="flow-title">{node.title}</span>
        <span className="flow-meta">{metaParts(node, episodes).join(" · ")}</span>
      </div>
    </Link>
  );
}

function ExtraTile({ extra, current, bases }: { extra: Extra; current: boolean; bases: string[] }) {
  const { node } = extra;
  const ref = useRef<HTMLAnchorElement>(null);
  const episodes = useEpisodeCount(node.id, ref, node.loaded && node.type !== "Movie");
  const label = LABELS[extra.label] ?? extra.label;
  const shown = shortTitle(node.title, extra.via ? [extra.via.title, ...bases] : bases);
  return (
    <Link
      ref={ref}
      to={`/post/${node.id}`}
      className={`flow-extra${current ? " current" : ""}`}
      aria-current={current ? "page" : undefined}
      title={extra.via ? `${node.title} (${label} of ${extra.via.title})` : node.title}
    >
      <div className="flow-thumb">{node.poster && <img src={node.poster} alt="" loading="lazy" decoding="async" />}</div>
      <div className="flow-x-info">
        <span className="flow-rel">
          {label}
          {extra.via && <span className="flow-via"> · {extra.via.title}</span>}
        </span>
        <span className="flow-x-title">{shown}</span>
        <span className="flow-x-meta">
          {node.type && <span className={`fmt inline ${formatClass(node)}`}>{node.type}</span>}
          {metaParts(node, episodes, true).join(" · ")}
        </span>
      </div>
    </Link>
  );
}

interface FlowStepProps {
  step: Step;
  index: number;
  solo: boolean;
  currentId: number;
  franchise: string; // title of the first step
}

function FlowStep({ step, index, solo, currentId, franchise }: FlowStepProps) {
  const [open, setOpen] = useState(false);
  const limit = solo ? EXTRAS_SHOWN_SOLO : EXTRAS_SHOWN;
  const here = step.extras.findIndex((e) => e.node.id === currentId);
  const shown = open ? step.extras : step.extras.filter((_, i) => i < limit || i === here);
  const hidden = step.extras.length - shown.length;
  const current = step.node.id === currentId;
  return (
    <div className={`flow-col${current ? " current" : ""}`} role="listitem">
      <div className="flow-marker" aria-hidden="true">
        <span className="flow-num">{index + 1}</span>
      </div>
      <MainTile node={step.node} current={current} />
      {!!step.extras.length && (
        <div className="flow-extras">
          {shown.map((e) => (
            <ExtraTile key={e.node.id} extra={e} current={e.node.id === currentId} bases={[step.node.title, franchise]} />
          ))}
          {(hidden > 0 || open) && (
            <button className="flow-more" onClick={() => setOpen(!open)}>
              {open ? "Show less" : `+${hidden} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function summary(steps: Step[]): string {
  const all = steps.flatMap((s) => [s.node, ...s.extras.map((e) => e.node)]);
  const series = all.filter(isSeries).length;
  const movies = all.filter((n) => n.type === "Movie").length;
  const other = all.length - series - movies;
  const count = (n: number, one: string, many: string) => (n ? [`${n} ${n === 1 ? one : many}`] : []);
  return [
    ...count(all.length, "title", "titles"),
    ...count(series, "series", "series"),
    ...count(movies, "movie", "movies"),
    ...count(other, "OVA or special", "OVAs & specials"),
  ].join(" · ");
}

export default function FranchiseFlow({ post }: { post: PostDetail }) {
  const related = !!post.seasons?.length;
  const [graph, setGraph] = useState<{ id: number; nodes: Map<number, FranchiseNode> } | null>(null);
  useEffect(() => {
    if (!related) return;
    let live = true;
    franchiseOf(post).then((nodes) => live && setGraph({ id: post.id, nodes }));
    return () => {
      live = false;
    };
  }, [post, related]);
  const steps = useMemo(() => (graph && graph.id === post.id ? layoutFranchise(graph.nodes, post.id) : null), [graph, post.id]);

  if (!related) return null;
  return (
    <section className="franchise">
      <div className="franchise-head">
        <h2 className="row-title">Watch order</h2>
        {steps && <p className="franchise-sum">{summary(steps)}</p>}
      </div>
      {steps ? (
        <div className={`flow${steps.length === 1 ? " solo" : ""}`} role="list">
          {steps.map((s, i) => (
            <FlowStep key={s.node.id} step={s} index={i} solo={steps.length === 1} currentId={post.id} franchise={steps[0].node.title} />
          ))}
        </div>
      ) : (
        <div className="flow" aria-busy="true" aria-label="Loading watch order">
          {[0, 1, 2, 3].map((i) => (
            <div className="flow-col skeleton" key={i}>
              <div className="flow-marker">
                <span className="flow-num" />
              </div>
              <div className="flow-art" />
              <div className="skeleton-line" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
