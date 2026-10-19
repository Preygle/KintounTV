import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMetas } from "../catalog";
import { CardSkeleton, Chips, PageHeader, PosterCard, Status } from "../components";
import { getMyListState, toggleMyList, useMyList } from "../myList";
import { HistoryGrid } from "../WatchCards";

type Format = "all" | "series" | "movie" | "other";
type State = "all" | "airing" | "finished";
type Sort = "added" | "title";

const FORMATS: { value: Format; label: string }[] = [
  { value: "all", label: "All" },
  { value: "series", label: "Series" },
  { value: "movie", label: "Movies" },
  { value: "other", label: "OVA & Specials" },
];

function formatOf(type: string | null): Format {
  if (type === "TV" || type === "ONA") return "series";
  if (type === "Movie") return "movie";
  return "other";
}

function Watchlist() {
  const ids = useMyList();
  const { metas, pending } = useMetas(ids, true);
  const [format, setFormat] = useState<Format>("all");
  const [status, setStatus] = useState<State>("all");
  const [sort, setSort] = useState<Sort>("added");
  if (!ids.length) return <Status message="Your list is empty. Use “Add to My List” on any title to save it here." />;

  const added = getMyListState().items;
  const shown = ids
    .filter((id) => {
      const m = metas.get(id);
      if (!m) return format === "all" && status === "all"; // still loading
      if (format !== "all" && formatOf(m.type) !== format) return false;
      if (status === "airing") return m.status === "Currently Airing";
      if (status === "finished") return m.status === "Finished Airing";
      return true;
    })
    .sort((a, b) => (sort === "title" ? (metas.get(a)?.title ?? "").localeCompare(metas.get(b)?.title ?? "") : (added[b] ?? 0) - (added[a] ?? 0)));

  return (
    <>
      <div className="filters list-filters">
        <Chips label="Format" options={FORMATS} value={format} onChange={setFormat} />
        <Chips
          label="Status"
          options={[
            { value: "all", label: "Any status" },
            { value: "airing", label: "Airing" },
            { value: "finished", label: "Finished" },
          ]}
          value={status}
          onChange={setStatus}
        />
        <label className="select">
          <span className="visually-hidden">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="added">Recently added</option>
            <option value="title">Title A–Z</option>
          </select>
        </label>
        <span className="list-count">
          {shown.length} of {ids.length}
        </span>
      </div>
      {shown.length ? (
        <div className="grid">
          {shown.map((id) => (
            <PosterCard key={id} post={{ id, poster: metas.get(id)?.poster ?? "", age: metas.get(id)?.age ?? null }} onRemove={() => toggleMyList(id)} />
          ))}
        </div>
      ) : pending ? (
        <div className="grid">
          {Array.from({ length: Math.min(pending, 12) }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <Status message="Nothing in your list matches these filters." />
      )}
    </>
  );
}

export default function MyList() {
  const tab = useSearchParams()[0].get("tab") === "history" ? "history" : "list";
  return (
    <>
      <PageHeader title="My List">
        <nav className="tabs" role="tablist">
          <Link to="/my-list" replace role="tab" aria-selected={tab === "list"} className={tab === "list" ? "active" : ""}>
            Watchlist
          </Link>
          <Link to="/my-list?tab=history" replace role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""}>
            History
          </Link>
        </nav>
      </PageHeader>
      {tab === "history" ? <HistoryGrid /> : <Watchlist />}
    </>
  );
}
