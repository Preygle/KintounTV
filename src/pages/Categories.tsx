import { useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMeta } from "../catalog";
import { CATEGORY_GROUPS, type CategoryGroup, type CategoryInfo } from "../categoryInfo";
import { CardSkeleton, Img, PageHeader, PosterCard, Spinner, Status } from "../components";
import { useAsync } from "../hooks";
import { CheckIcon, CloseIcon } from "../icons";
import { useTagResults, type MatchMode } from "../tagSearch";

/** The guide's groups, plus any category the catalog has that the guide doesn't know yet. */
function useGroups(): CategoryGroup[] {
  const { data } = useAsync(api.categories, []);
  return useMemo(() => {
    const known = new Set(CATEGORY_GROUPS.flatMap((g) => g.categories.flatMap((c) => c.ids)));
    const extra = (data ?? []).filter((c) => !known.has(c.id));
    if (!extra.length) return CATEGORY_GROUPS;
    const byName = new Map<string, CategoryInfo>();
    for (const c of extra) {
      const hit = byName.get(c.name);
      if (hit) hit.ids.push(c.id);
      else byName.set(c.name, { name: c.name, ids: [c.id], blurb: "", cover: null, coverTitle: null });
    }
    return [...CATEGORY_GROUPS, { name: "More", blurb: "Other categories in the catalog.", categories: [...byName.values()] }];
  }, [data]);
}

function CategoryCard({ info, selected, onToggle }: { info: CategoryInfo; selected: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const cover = useMeta(info.cover ?? 0, ref, info.cover != null);
  return (
    <button ref={ref} className={`cat-card${selected ? " selected" : ""}`} onClick={onToggle} aria-pressed={selected}>
      <span className="cat-cover">
        {info.cover ? <Img src={cover?.poster} label={info.coverTitle ?? undefined} /> : <span className="cat-cover-plain">{info.name === "Hentai" || info.name === "Erotica" || info.name === "Ecchi" ? "18+" : info.name[0]}</span>}
      </span>
      <span className="cat-text">
        <strong>{info.name}</strong>
        {info.blurb && <span className="cat-blurb">{info.blurb}</span>}
        {info.coverTitle && <span className="cat-example">e.g. {info.coverTitle}</span>}
      </span>
      <span className="cat-check" aria-hidden="true">
        {selected ? <CheckIcon /> : "+"}
      </span>
    </button>
  );
}

function Results({ tags, mode }: { tags: CategoryInfo[]; mode: MatchMode }) {
  const { items, loading, error, done, checked, more } = useTagResults(
    tags.map((t) => t.ids),
    mode,
  );
  const names = tags.map((t) => t.name);
  const describe =
    tags.length === 1
      ? names[0]
      : `${mode === "all" ? "all of" : "any of"} ${names.slice(0, -1).join(", ")} ${mode === "all" ? "and" : "or"} ${names[names.length - 1]}`;
  const readAll = mode === "all" && tags.length > 1;
  const progress = readAll && loading ? ` · searching, ${checked.toLocaleString("en")} titles checked` : "";
  return (
    <section className="cat-results" aria-live="polite">
      <div className="row-head">
        <h2 className="row-title">
          {items.length || !loading ? `${items.length}${done ? "" : "+"} titles` : "Finding titles…"}
        </h2>
        <span className="cat-results-note">
          Matching {describe}
          {progress}
        </span>
      </div>
      {error && <Status message={error} onRetry={more} />}
      <div className="grid">
        {items.map((p) => (
          <PosterCard key={p.id} post={p} />
        ))}
        {loading && !items.length && Array.from({ length: 12 }, (_, i) => <CardSkeleton key={i} />)}
      </div>
      {!items.length && !loading && done && <Status message="No title is in all of these categories. Try “Any”, or fewer categories." />}
      {!done && !error && (
        <div className="cat-more">
          {loading ? (
            <Spinner />
          ) : (
            !readAll && (
              <button className="btn" onClick={more}>
                Load more
              </button>
            )
          )}
        </div>
      )}
    </section>
  );
}

export default function Categories() {
  const groups = useGroups();
  const all = groups.flatMap((g) => g.categories);
  const [params, setParams] = useSearchParams();
  // ?tags=1,100000 (first id of each category); ?c= is the older single-category link.
  const selectedIds = (params.get("tags") ?? params.get("c") ?? "").split(",").map(Number).filter(Boolean);
  const selected = selectedIds.map((id) => all.find((c) => c.ids.includes(id))).filter((c): c is CategoryInfo => !!c);
  const mode: MatchMode = params.get("mode") === "all" ? "all" : "any";

  const update = (next: CategoryInfo[], nextMode = mode) => {
    const p: Record<string, string> = {};
    if (next.length) p.tags = next.map((c) => c.ids[0]).join(",");
    if (next.length > 1 && nextMode === "all") p.mode = "all";
    setParams(p, { replace: true });
  };
  const toggle = (info: CategoryInfo) => update(selected.includes(info) ? selected.filter((c) => c !== info) : [...selected, info]);

  return (
    <>
      <PageHeader title="Categories">
        <p className="page-sub">Pick a category, or several to combine them. Choose whether titles need to match any or all of them.</p>
      </PageHeader>

      {!!selected.length && (
        <div className="tag-bar">
          <div className="tag-list" aria-label="Selected categories">
            {selected.map((c) => (
              <button key={c.name} className="tag" onClick={() => toggle(c)} aria-label={`Remove ${c.name}`}>
                {c.name}
                <CloseIcon />
              </button>
            ))}
          </div>
          {selected.length > 1 && (
            <div className="segmented" role="radiogroup" aria-label="Match">
              <button role="radio" aria-checked={mode === "any"} className={mode === "any" ? "active" : ""} onClick={() => update(selected, "any")} title="Titles in at least one selected category">
                Any <small>OR</small>
              </button>
              <button role="radio" aria-checked={mode === "all"} className={mode === "all" ? "active" : ""} onClick={() => update(selected, "all")} title="Titles in every selected category">
                All <small>AND</small>
              </button>
            </div>
          )}
          <button className="linklike" onClick={() => update([])}>
            Clear
          </button>
        </div>
      )}

      {!!selected.length && <Results key={`${selected.map((c) => c.name).join("|")}:${mode}`} tags={selected} mode={mode} />}

      {groups.map((g) => (
        <section key={g.name} className="cat-group">
          <div className="cat-group-head">
            <h2 className="section-title">{g.name}</h2>
            <span>{g.blurb}</span>
          </div>
          <div className="cat-grid">
            {g.categories.map((c) => (
              <CategoryCard key={c.name} info={c} selected={selected.includes(c)} onToggle={() => toggle(c)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
