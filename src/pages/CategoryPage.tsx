import { Navigate, useParams } from "react-router-dom";

// Old links (/category/:id) open the category on the Categories page.
export default function CategoryPage() {
  return <Navigate to={`/categories?c=${Number(useParams().id)}`} replace />;
}
