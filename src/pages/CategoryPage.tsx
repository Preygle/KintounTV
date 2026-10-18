import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { PagedGrid } from "../components";
import { usePaged } from "../hooks";
import { BackIcon } from "../icons";

export default function CategoryPage() {
  const id = Number(useParams().id);
  const title = useSearchParams()[0].get("title") ?? "Category";
  const navigate = useNavigate();
  const paged = usePaged((page) => api.category(id, page), [id]);
  return (
    <>
      <div className="page-title with-back">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <BackIcon />
        </button>
        <h1>{title}</h1>
      </div>
      <PagedGrid {...paged} />
    </>
  );
}
