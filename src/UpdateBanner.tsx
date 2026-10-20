import { Link } from "react-router-dom";
import { CloseIcon, DownloadIcon } from "./icons";
import { dismissUpdate, installLabel, installUpdate, isNewer, RELEASES_PAGE, useUpdates } from "./updates";

/** "KintounTV x.y.z is available" across the top of every page, until updated or dismissed. */
export default function UpdateBanner() {
  const u = useUpdates();
  const busy = installLabel(u.install);
  if (!isNewer(u.latest) || (u.dismissed === u.latest.version && !busy && u.install.state !== "error")) return null;
  return (
    <div className="update-banner" role="status">
      <DownloadIcon />
      <span>
        {busy || (u.install.state === "error" ? `Update failed: ${u.install.error}` : `KintounTV ${u.latest.version} is available.`)}{" "}
        {!busy && (
          <Link to="/account#updates" className="update-more">
            What's new
          </Link>
        )}
      </span>
      {u.install.state === "downloading" && (
        <span className="update-progress" aria-hidden="true">
          <span style={{ width: `${u.install.progress * 100}%` }} />
        </span>
      )}
      {!busy &&
        (u.installable ? (
          <button className="btn primary small" onClick={() => void installUpdate()}>
            {u.install.state === "error" ? "Try again" : "Update now"}
          </button>
        ) : (
          <a className="btn primary small" href={RELEASES_PAGE} target="_blank" rel="noreferrer">
            Download
          </a>
        ))}
      {!busy && (
        <button className="icon-btn" onClick={dismissUpdate} aria-label="Later">
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
