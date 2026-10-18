import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { PageHeader, PagedGrid, Status } from "../components";
import { usePaged } from "../hooks";
import { SearchIcon } from "../icons";

export default function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);

  // Debounce typing into the URL so results survive navigation back from a post.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = input.trim();
      if (q !== query) setParams(q ? { q } : {}, { replace: true });
    }, 400);
    return () => clearTimeout(t);
  }, [input, query, setParams]);

  const paged = usePaged((page) => (query ? api.search(query, page) : Promise.resolve([])), [query]);

  return (
    <>
      <PageHeader title="Search" />
      <label className="search-box">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search anime…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          enterKeyHint="search"
        />
      </label>
      {query ? (
        <PagedGrid {...paged} empty={<Status message={`No results for “${query}”.`} />} />
      ) : (
        <Status message="Type a title to start searching." />
      )}
    </>
  );
}
