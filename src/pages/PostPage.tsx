import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, watchApi } from "../api";
import { rememberMeta, useBanner } from "../catalog";
import { Img, PosterRow, Rating, Spinner, Status } from "../components";
import FranchiseFlow from "../FranchiseFlow";
import { useAsync } from "../hooks";
import { BackIcon, BookmarkIcon, PlayIcon, ShareIcon } from "../icons";
import { toggleMyList, useMyList } from "../myList";
import { useProgress } from "../progress";

export default function PostPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data: post, error, loading, reload } = useAsync(() => api.post(id), [id]);
  const inList = useMyList().includes(id);
  const resume = useProgress().last[id];
  const [copied, setCopied] = useState(false);
  const banner = useBanner(id, post?.title, !!post);
  useEffect(() => {
    if (post) rememberMeta(post);
  }, [post]);
  // Warm the episode list so pressing Watch starts playback sooner.
  useEffect(() => {
    watchApi.episodes(id).catch(() => {});
  }, [id]);

  if (loading && !post) return <Spinner />;
  if (error || !post) return <Status message={error ?? "Could not load this title."} onRetry={reload} />;

  // In the desktop app the page URL is a loopback address, so copy the post's share text instead.
  const isDesktop = window.location.hostname === "127.0.0.1";
  const share = async () => {
    const data = { title: post.title, url: window.location.href };
    if (!isDesktop && navigator.share) {
      await navigator.share(data).catch(() => {});
    } else {
      await navigator.clipboard?.writeText(isDesktop ? post.share ?? post.title : data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <section className="hero detail">
        <div className="hero-art" aria-hidden="true">
          {banner ? <img className="hero-banner" src={banner} alt="" /> : <img className="hero-blur" src={post.poster} alt="" />}
        </div>
        <button className="round-btn hero-back" onClick={() => navigate(-1)} aria-label="Back">
          <BackIcon />
        </button>
        <div className="hero-body">
          <Img className="hero-poster" src={post.poster} label={post.title} />
          <div className="hero-info">
            <h1>{post.title}</h1>
            <p className="hero-facts">
              {Number(post.score) > 0 && <Rating score={Number(post.score)} />}
              {[post.type, post.status, post.runtime, post.premiered, post.age].filter(Boolean).map((f) => (
                <span key={f}>{f}</span>
              ))}
            </p>
            {post.genres && <p className="hero-genres">{post.genres}</p>}
            <div className="actions">
              <Link to={`/watch/${id}`} className="btn primary watch-btn">
                <PlayIcon /> {resume ? `Continue · Ep ${resume.number}` : "Watch Now"}
              </Link>
              <button className="btn" onClick={() => toggleMyList(id)} aria-pressed={inList}>
                <BookmarkIcon filled={inList} /> {inList ? "In My List" : "Add to My List"}
              </button>
              <button className="btn" onClick={share}>
                <ShareIcon /> {copied ? "Copied" : "Share"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {post.overview && (
        <section className="overview">
          <h2 className="row-title">Overview</h2>
          <p>{post.overview}</p>
        </section>
      )}

      <FranchiseFlow post={post} />
      <PosterRow title="Related" posts={post.related} />
      <PosterRow title="You may also like" posts={post.similar} />
    </>
  );
}
