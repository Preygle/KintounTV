import { Link } from "react-router-dom";
import { api } from "../api";
import { PageHeader, Spinner, Status } from "../components";
import { useAsync } from "../hooks";

export default function Categories() {
  const { data, error, loading, reload } = useAsync(api.categories, []);
  return (
    <>
      <PageHeader title="Categories" />
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <Status message={error ?? "Could not load categories."} onRetry={reload} />
      ) : (
        <div className="category-grid">
          {data.map((c) => (
            <Link key={c.id} to={`/category/${c.id}?title=${encodeURIComponent(c.name)}`} className="category-card">
              {c.name}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
