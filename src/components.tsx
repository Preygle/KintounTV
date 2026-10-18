import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { Post, Season } from "./api";

export function PosterCard({ post }: { post: Post }) {
  return (
    <Link to={`/post/${post.id}`} className="poster-card">
      <img src={post.poster} alt="" loading="lazy" decoding="async" />
      {post.age && <span className="badge">{post.age}</span>}
    </Link>
  );
}

export function SeasonCard({ season }: { season: Season }) {
  return (
    <Link to={`/post/${season.id}`} className="season-card">
      <div className="poster-card">
        <img src={season.poster} alt="" loading="lazy" decoding="async" />
      </div>
      <span className="season-title">{season.title}</span>
    </Link>
  );
}

export function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="row">
      <h2 className="row-title">{title}</h2>
      <div className="row-scroller">{children}</div>
    </section>
  );
}

export function PosterRow({ title, posts }: { title: string; posts: Post[] | null | undefined }) {
  if (!posts?.length) return null;
  return (
    <Row title={title}>
      {posts.map((p) => (
        <PosterCard key={p.id} post={p} />
      ))}
    </Row>
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
}

export function PagedGrid({ items, loading, done, error, loadMore, retry, empty }: PagedGridProps) {
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
        {items.map((p) => (
          <PosterCard key={p.id} post={p} />
        ))}
      </div>
      {error && <Status message={error} onRetry={retry} />}
      {loading && <Spinner />}
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

export function PageHeader({ title }: { title: string }) {
  return <h1 className="page-title">{title}</h1>;
}
