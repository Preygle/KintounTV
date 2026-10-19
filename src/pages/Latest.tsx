import { api } from "../api";
import { PageHeader, PagedGrid, PosterCard } from "../components";
import { usePaged } from "../hooks";

export default function Latest() {
  const paged = usePaged(api.latest, []);
  return (
    <>
      <PageHeader title="Latest">
        <p className="page-sub">Recently added titles and shows with new episodes.</p>
      </PageHeader>
      <PagedGrid {...paged} card={(p) => <PosterCard key={p.id} post={p} release />} />
    </>
  );
}
