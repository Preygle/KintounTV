import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GENRES, useMetas } from "../catalog";
import { Chips, PageHeader, PagedGrid, Status } from "../components";
import { usePaged } from "../hooks";

// The query comes from the search field in the header (the only search input).
export default function Search() {
  const query = useSearchParams()[0].get("q")?.trim() ?? "";
  const paged = usePaged((page) => (query ? api.search(query, page) : Promise.resolve([])), [query]);
  const [genre, setGenre] = useState("All");
  const [year, setYear] = useState(0);
  // Results are few, so their details are loaded up front: the filters need genres and years.
  const { metas, pending } = useMetas(
    paged.items.map((p) => p.id),
    !!query,
  );
  const years = [...new Set([...metas.values()].map((m) => m.year).filter((y): y is number => !!y))].sort((a, b) => b - a);
  const filtering = genre !== "All" || year !== 0;
  const items = filtering
    ? paged.items.filter((p) => {
        const m = metas.get(p.id);
        return !!m && (genre === "All" || m.genres.includes(genre)) && (!year || m.year === year);
      })
    : paged.items;

  if (!query) {
    return (
      <>
        <PageHeader title="Search" />
        <Status message="Type a title, genre or studio in the search field above (Ctrl + K)." />
      </>
    );
  }
  return (
    <>
      <PageHeader title={`Results for “${query}”`}>
        <div className="filters">
          <Chips label="Filter by genre" options={GENRES.map((g) => ({ value: g, label: g }))} value={genre} onChange={setGenre} />
          <label className="select">
            <span className="visually-hidden">Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              <option value={0}>Any year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </PageHeader>
      <PagedGrid
        {...paged}
        items={items}
        done={paged.done && (!filtering || !pending)}
        empty={<Status message={filtering ? "No results match these filters." : `No results for “${query}”.`} />}
      />
    </>
  );
}
