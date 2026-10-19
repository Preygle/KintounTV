import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Chips, PageHeader, PagedGrid, Spinner, Status } from "../components";
import { useAsync, usePaged } from "../hooks";

function CategoryGrid({ id }: { id: number }) {
  const paged = usePaged((page) => api.category(id, page), [id]);
  return <PagedGrid {...paged} />;
}

export default function Categories() {
  const { data, error, loading, reload } = useAsync(api.categories, []);
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get("c")) || data?.[0]?.id || 0;
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <PageHeader title="Categories">
        {data && (
          <div className={`category-chips${expanded ? " expanded" : ""}`}>
            <Chips
              label="Category"
              options={(expanded ? data : [...data].sort((a, b) => Number(b.id === selected) - Number(a.id === selected))).map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              value={selected}
              onChange={(c) => setParams({ c: String(c) }, { replace: true })}
            />
            <button className="linklike" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              {expanded ? "Show fewer" : `Show all ${data.length}`}
            </button>
          </div>
        )}
      </PageHeader>
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <Status message={error ?? "Could not load categories."} onRetry={reload} />
      ) : (
        selected > 0 && <CategoryGrid key={selected} id={selected} />
      )}
    </>
  );
}
