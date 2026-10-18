import { api } from "../api";
import { PageHeader, PagedGrid } from "../components";
import { usePaged } from "../hooks";

export default function Latest() {
  const paged = usePaged(api.latest, []);
  return (
    <>
      <PageHeader title="Latest" />
      <PagedGrid {...paged} />
    </>
  );
}
