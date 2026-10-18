import { Link } from "react-router-dom";
import { api, type Featured } from "../api";
import { PosterRow, Spinner, Status } from "../components";
import { useAsync } from "../hooks";
import { BookmarkIcon, InfoIcon, PlayIcon } from "../icons";
import { toggleMyList, useMyList } from "../myList";
import { ContinueWatchingRow } from "../WatchCards";
import { metaLine } from "./meta";

function Hero({ featured }: { featured: Featured }) {
  const inList = useMyList().includes(featured.id);
  return (
    <section className="hero">
      <div className="hero-bg" style={{ backgroundImage: `url(${featured.poster})` }} />
      <div className="hero-body">
        <img className="hero-poster" src={featured.poster} alt="" />
        <div className="hero-info">
          <h1>{featured.title}</h1>
          <p className="meta">{metaLine(featured)}</p>
          {featured.genres && <p className="genres">{featured.genres}</p>}
          <div className="actions">
            <Link to={`/watch/${featured.id}`} className="btn primary watch-btn">
              <PlayIcon /> Watch
            </Link>
            <Link to={`/post/${featured.id}`} className="btn">
              <InfoIcon /> Details
            </Link>
            <button className="btn" onClick={() => toggleMyList(featured.id)} aria-pressed={inList}>
              <BookmarkIcon filled={inList} /> {inList ? "In My List" : "My List"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { data, error, loading, reload } = useAsync(api.home, []);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <Status message={error ?? "Could not load home."} onRetry={reload} />;
  return (
    <>
      {data.featured && <Hero featured={data.featured} />}
      <ContinueWatchingRow />
      {data.sections.map((s) => (
        <PosterRow key={s.name} title={s.name} posts={s.posts} />
      ))}
    </>
  );
}
