import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Post } from "./api";
import { useEpisodeCount, useMeta } from "./catalog";
import { ChevronIcon, CloseIcon, StarIcon } from "./icons";

/** An image that falls back to the logo mark (and optional text) when missing or broken. */
export function Img({ src, alt = "", label, className }: { src?: string | null; alt?: string; label?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className={`img-fallback ${className ?? ""}`} aria-hidden="true">
        <img src="/logo-mark.png" alt="" />
        {label && <span>{label}</span>}
      </div>
    );
  }
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function Rating({ score }: { score: number }) {
  return (
    <span className="rating" aria-label={`Rated ${score}`}>
      <StarIcon />
      {score}
    </span>
  );
}

interface PosterCardProps {
  post: Post;
  release?: boolean; // show season/airing line (Latest)
  onRemove?: () => void;
}

/** Vertical 2:3 poster with its title, rating, format and episode count below. */
export function PosterCard({ post, release, onRemove }: PosterCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const meta = useMeta(post.id, ref);
  const episodes = useEpisodeCount(post.id, ref, !!meta && meta.type !== "Movie");
  return (
    <div className="card" ref={ref}>
      <Link to={`/post/${post.id}`} className="card-link" title={meta?.title}>
        <div className="card-poster">
          <Img src={post.poster || meta?.poster} label={meta?.title} />
          {post.age && <span className="age-badge">{post.age}</span>}
          {meta?.status === "Currently Airing" && <span className="airing-badge">Airing</span>}
        </div>
        <div className="card-body">
          {meta ? <span className="card-title">{meta.title}</span> : <span className="skel skel-title" />}
          <div className="card-meta">
            {meta?.score != null && <Rating score={meta.score} />}
            {meta?.type && <span className="pill">{meta.type}</span>}
            {episodes != null && meta?.type !== "Movie" && <span className="pill">{episodes === 1 ? "1 ep" : `${episodes} eps`}</span>}
          </div>
          {release && meta?.premiered && <span className="card-release">{meta.premiered}</span>}
        </div>
      </Link>
      {onRemove && (
        <button className="card-remove" onClick={onRemove} aria-label={`Remove ${meta?.title ?? "title"} from My List`} title="Remove from My List">
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card skeleton" aria-hidden="true">
      <div className="card-poster skel" />
      <div className="card-body">
        <span className="skel skel-title" />
        <span className="skel skel-meta" />
      </div>
    </div>
  );
}

interface RowProps {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode; // right side of the heading (filters, View History)
  className?: string;
  children: React.ReactNode;
}

/** Horizontal carousel with a heading and previous/next buttons. */
export function Row({ title, icon, action, className, children }: RowProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = scroller.current;
    if (el) setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);
  const page = (dir: number) => {
    const el = scroller.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <section className={`row ${className ?? ""}`}>
      <div className="row-head">
        <h2 className="row-title">
          {icon && <span className="row-icon">{icon}</span>}
          {title}
        </h2>
        {action}
      </div>
      <div className="row-frame">
        <button className="row-arrow prev" hidden={edges.start} onClick={() => page(-1)} aria-label={`Scroll ${title} back`}>
          <ChevronIcon back />
        </button>
        <div className="row-scroller" ref={scroller} onScroll={update}>
          {children}
        </div>
        <button className="row-arrow next" hidden={edges.end} onClick={() => page(1)} aria-label={`Scroll ${title} forward`}>
          <ChevronIcon />
        </button>
      </div>
    </section>
  );
}

export function PosterRow({ title, posts, icon }: { title: string; posts: Post[] | null | undefined; icon?: React.ReactNode }) {
  if (!posts?.length) return null;
  return (
    <Row title={title} icon={icon}>
      {posts.map((p) => (
        <PosterCard key={p.id} post={p} />
      ))}
    </Row>
  );
}

export function RowSkeleton() {
  return (
    <section className="row" aria-hidden="true">
      <div className="row-head">
        <span className="skel skel-heading" />
      </div>
      <div className="row-frame">
        <div className="row-scroller">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

export interface ChipOption<T> {
  value: T;
  label: string;
}

/** Single-choice filter chips. */
export function Chips<T extends string | number>({ options, value, onChange, label }: { options: ChipOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={`filter-chip${o.value === value ? " active" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface PagedGridProps {
  items: Post[];
  loading: boolean;
  done: boolean;
  error: string | null;
  loadMore: () => void;
  retry: () => void;
  empty?: React.ReactNode;
  card?: (post: Post) => React.ReactNode;
}

export function PagedGrid({ items, loading, done, error, loadMore, retry, empty, card }: PagedGridProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  if (done && !items.length && !error) return <>{empty ?? <Status message="Nothing here yet." />}</>;
  return (
    <>
      <div className="grid">
        {items.map((p) => (card ? card(p) : <PosterCard key={p.id} post={p} />))}
        {loading && !items.length && Array.from({ length: 12 }, (_, i) => <CardSkeleton key={`s${i}`} />)}
      </div>
      {error && <Status message={error} onRetry={retry} />}
      {loading && !!items.length && <Spinner />}
      <div ref={sentinel} />
    </>
  );
}

export function Spinner() {
  return (
    <div className="spinner" role="status" aria-label="Loading">
      <span />
    </div>
  );
}

export function Status({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="status">
      <p>{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <h1 className="page-title">{title}</h1>
      {children}
    </div>
  );
}
