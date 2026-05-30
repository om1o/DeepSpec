import { Link } from "react-router-dom";
import { getCloudSyncStatus } from "../../services/cloudSync";

export default function HistoryDockButton() {
  const cloudSync = getCloudSyncStatus();
  const cloudLabel = cloudSync.configured ? "Cloud + local" : "Local only";
  const cloudDotClass = cloudSync.configured ? "ds-history-dock-dot-ready" : "ds-history-dock-dot-local";

  return (
    <Link
      aria-label="Open saved scan history"
      className="ds-history-dock"
      to="/history"
    >
      <span aria-hidden="true" className={`ds-history-dock-dot ${cloudDotClass}`} />
      <span className="ds-history-dock-title">History</span>
      <span className="ds-history-dock-subtitle">{cloudLabel}</span>
    </Link>
  );
}
