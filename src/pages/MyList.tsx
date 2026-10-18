import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { PageHeader, PagedGrid, Status } from "../components";
import { usePaged } from "../hooks";
import { useMyList } from "../myList";
import { HistoryGrid } from "../WatchCards";

function Watchlist() {
  const ids = useMyList();
  const paged = usePaged((page) => (ids.length ? api.myList(ids, page) : Promise.resolve([])), [ids]);
  return <PagedGrid {...paged} empty={<Status message="Your list is empty. Tap the bookmark on any title to save it here." />} />;
}

export default function MyList() {
  const tab = useSearchParams()[0].get("tab") === "history" ? "history" : "list";
  return (
    <>
      <PageHeader title="My List" />
      <nav className="tabs" role="tablist">
        <Link to="/my-list" replace role="tab" aria-selected={tab === "list"} className={tab === "list" ? "active" : ""}>
          Watchlist
        </Link>
        <Link to="/my-list?tab=history" replace role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""}>
          History
        </Link>
      </nav>
      {tab === "history" ? <HistoryGrid /> : <Watchlist />}
    </>
  );
}
