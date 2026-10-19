import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type HomeResponse, type Post } from "../api";
import { GENRES, rememberMeta, useBanner, useMetas } from "../catalog";
import { Chips, Img, PosterCard, PosterRow, Rating, Row, RowSkeleton, Status } from "../components";
import { useAsync } from "../hooks";
import { BookmarkIcon, ChevronIcon, FlameIcon, InfoIcon, PlayIcon } from "../icons";
import { toggleMyList, useMyList } from "../myList";
import { useProgress } from "../progress";
import { ContinueWatchingRow } from "../WatchCards";

const HERO_SLIDES = 5;
const HERO_INTERVAL = 9000;

function HeroSlide({ id, active }: { id: number; active: boolean }) {
  const { data: post } = useAsync(() => api.post(id), [id]);
  const banner = useBanner(id, post?.title, !!post);
  const inList = useMyList().includes(id);
  const resume = useProgress().last[id];
  useEffect(() => {
    if (post) rememberMeta(post);
  }, [post]);
  if (!post) return <div className="hero-slide" aria-hidden={!active} />;
  const score = Number(post.score);
  const facts = [post.type, post.status, post.runtime, post.premiered, post.age].filter(Boolean) as string[];
  return (
    <div className={`hero-slide${active ? " active" : ""}`} aria-hidden={!active}>
      <div className="hero-art" aria-hidden="true">
        {banner ? <img className="hero-banner" src={banner} alt="" /> : <img className="hero-blur" src={post.poster} alt="" />}
      </div>
      <div className="hero-body">
        <Img className="hero-poster" src={post.poster} label={post.title} />
        <div className="hero-info">
          <h1>{post.title}</h1>
          <p className="hero-facts">
            {score > 0 && <Rating score={score} />}
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </p>
          {post.overview && <p className="hero-overview">{post.overview}</p>}
          <div className="actions">
            <Link to={`/watch/${id}`} className="btn primary" tabIndex={active ? 0 : -1}>
              <PlayIcon /> {resume ? `Continue · Ep ${resume.number}` : "Watch Now"}
            </Link>
            <button className="btn" onClick={() => toggleMyList(id)} aria-pressed={inList} tabIndex={active ? 0 : -1}>
              <BookmarkIcon filled={inList} /> {inList ? "In My List" : "Add to My List"}
            </button>
            <Link to={`/post/${id}`} className="btn" tabIndex={active ? 0 : -1}>
              <InfoIcon /> Details
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero({ ids }: { ids: number[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = ids.length;
  const go = (i: number) => setIndex(((i % count) + count) % count);

  useEffect(() => {
    if (paused || count < 2) return;
    const t = setTimeout(() => !document.hidden && go(index + 1), HERO_INTERVAL);
    return () => clearTimeout(t);
  }, [index, paused, count]);

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {ids.map((id, i) => (
        <HeroSlide key={id} id={id} active={i === index} />
      ))}
      {count > 1 && (
        <div className="hero-controls">
          <div className="hero-dots" role="tablist" aria-label="Featured titles">
            {ids.map((id, i) => (
              <button key={id} role="tab" aria-selected={i === index} aria-label={`Show featured title ${i + 1}`} className={i === index ? "active" : ""} onClick={() => go(i)} />
            ))}
          </div>
          <button className="round-btn" onClick={() => go(index - 1)} aria-label="Previous featured title">
            <ChevronIcon back />
          </button>
          <button className="round-btn" onClick={() => go(index + 1)} aria-label="Next featured title">
            <ChevronIcon />
          </button>
        </div>
      )}
    </section>
  );
}

function Trending({ title, posts }: { title: string; posts: Post[] }) {
  const [genre, setGenre] = useState("All");
  const filtering = genre !== "All";
  const ids = posts.map((p) => p.id);
  const { metas, pending } = useMetas(ids, filtering);
  const shown = filtering ? posts.filter((p) => metas.get(p.id)?.genres.includes(genre)) : posts;
  return (
    <Row
      title={title}
      icon={<FlameIcon />}
      className="trending-row"
      action={<Chips label="Filter by genre" options={GENRES.map((g) => ({ value: g, label: g }))} value={genre} onChange={setGenre} />}
    >
      {shown.map((p) => (
        <PosterCard key={p.id} post={p} />
      ))}
      {filtering && !shown.length && <p className="row-empty">{pending ? "Finding titles…" : `No ${genre} titles here right now.`}</p>}
    </Row>
  );
}

function heroIds(data: HomeResponse): number[] {
  const ids = [data.featured?.id, ...(data.sections[0]?.posts ?? []).map((p) => p.id)].filter((id): id is number => id != null);
  return [...new Set(ids)].slice(0, HERO_SLIDES);
}

export default function Home() {
  const { data, error, loading, reload } = useAsync(api.home, []);
  const rememberedFeatured = useRef(false);
  useEffect(() => {
    if (data?.featured && !rememberedFeatured.current) {
      rememberedFeatured.current = true;
      rememberMeta(data.featured);
    }
  }, [data]);

  if (loading && !data) {
    return (
      <>
        <section className="hero skeleton" aria-busy="true" aria-label="Loading" />
        <RowSkeleton />
        <RowSkeleton />
      </>
    );
  }
  if (error || !data) return <Status message={error ?? "Could not load home."} onRetry={reload} />;
  const trending = data.sections.findIndex((s) => /trending/i.test(s.name));
  return (
    <>
      <Hero ids={heroIds(data)} />
      <ContinueWatchingRow />
      {data.sections.map((s, i) =>
        i === trending ? <Trending key={s.name} title={s.name} posts={s.posts} /> : <PosterRow key={s.name} title={s.name} posts={s.posts} />,
      )}
    </>
  );
}
