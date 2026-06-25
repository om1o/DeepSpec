import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import ScanThumb from "../components/ui/ScanThumb";
import { signOut } from "../services/auth";
import { readCloudLookups } from "../services/cloudHistory";
import { getScanQualityMetrics, type ScanQualityFailureReason, type ScanQualityMetrics } from "../services/scanQualityMetrics";
import { MAX_SAVED_LOOKUPS, getLookups, scanStateFromLookup } from "../services/storage";
import { getTrainingReadiness } from "../services/trainingReadiness";
import { SCAN_CATEGORIES, type Lookup, type Rating, type ScanCategory, type TrainingStatus } from "../types";

export default function History() {
  const navigate = useNavigate();
  const [lookups, setLookups] = useState<Lookup[]>(() => getLookups());
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [query, setQuery] = useState("");
  const qualityMetrics = useMemo(() => getScanQualityMetrics(), []);

  useEffect(() => {
    let isMounted = true;
    const localLookups = getLookups();

    void readCloudLookups()
      .then((result) => {
        if (!isMounted || !result.ok) {
          return;
        }

        setLookups(mergeLookups(localLookups, result.value));
      })
      .catch(() => {
        // Keep local history if cloud history fails to load.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut();
      navigate("/auth", { replace: true });
    } catch {
      setIsSigningOut(false);
    }
  }

  const [categoryFilter, setCategoryFilter] = useState<ScanCategory | "all">("all");
  const [reviewFilter, setReviewFilter] = useState<TrainingStatus | "error" | "all">("all");
  const [ratingFilter, setRatingFilter] = useState<Exclude<Rating, null> | "unrated" | "all">("all");
  const filteredLookups = useMemo(
    () =>
      lookups.filter(
        (lookup) =>
          matchesQuery(lookup, query) &&
          matchesCategory(lookup, categoryFilter) &&
          matchesReviewStatus(lookup, reviewFilter) &&
          matchesRating(lookup, ratingFilter),
      ),
    [categoryFilter, lookups, query, ratingFilter, reviewFilter],
  );

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-md">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <img src="/brand/deepspec-logo.webp" alt="Deep Spec" className="h-12 w-36 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Saved scans</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 disabled:opacity-60"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
            <Link to="/early-access" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
              Join
            </Link>
            <Link to="/shop" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
              Shop
            </Link>
            <Link to="/scan" className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white shadow-sm">
              Scan
            </Link>
          </div>
        </header>

        <ScanQualityMetricsPanel metrics={qualityMetrics} />

        {lookups.length > 0 ? (
          <section className="mt-5 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block">
              <span className="sr-only">Search saved scans</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)]"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search saved scans"
                value={query}
              />
            </label>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FilterSelect label="Filter category" value={categoryFilter} onChange={(value) => setCategoryFilter(value as ScanCategory | "all")}>
                <option value="all">All categories</option>
                {SCAN_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect label="Filter review status" value={reviewFilter} onChange={(value) => setReviewFilter(value as TrainingStatus | "error" | "all")}>
                <option value="all">All review states</option>
                <option value="raw_unreviewed">Unreviewed</option>
                <option value="user_confirmed">Confirmed</option>
                <option value="user_corrected">Corrected</option>
                <option value="error">AI errors</option>
              </FilterSelect>
              <FilterSelect label="Filter rating" value={ratingFilter} onChange={(value) => setRatingFilter(value as Exclude<Rating, null> | "unrated" | "all")}>
                <option value="all">All ratings</option>
                <option value="up">Helpful</option>
                <option value="down">Wrong</option>
                <option value="unrated">Unrated</option>
              </FilterSelect>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-neutral-500">
                {filteredLookups.length}/{lookups.length} saved scans
              </p>
              <Button type="button" onClick={() => exportLookups(lookups)}>
                Export JSON
              </Button>
            </div>
            {lookups.length >= MAX_SAVED_LOOKUPS ? (
              <p className="mt-2 text-xs font-semibold leading-5 text-[var(--ds-warn-ink)]">
                {MAX_SAVED_LOOKUPS}-scan cap reached. Export to keep older scans.
              </p>
            ) : null}
          </section>
        ) : null}

        {filteredLookups.length > 0 ? (
          <div className="mt-6 space-y-3">
            {filteredLookups.map((lookup) => (
              <LookupCard key={lookup.id} lookup={lookup} />
            ))}
          </div>
        ) : lookups.length > 0 ? (
          <section className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-[var(--ds-accent)]">No scans match</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">Clear the filters to see every saved scan.</p>
          </section>
        ) : (
          <section className="mt-8 rounded-[24px] border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-[var(--ds-accent)]">No saved scans yet</p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">Scan your first part</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-500">
              Photo, result, rating, correction, and notes stay on this device.
            </p>
            <Button className="mt-5 w-full" onClick={() => window.location.assign("/scan")}>
              Open scanner
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}

function ScanQualityMetricsPanel({ metrics }: { metrics: ScanQualityMetrics }) {
  const firstPassRate = formatPercent(metrics.firstPassSuccesses, metrics.attempts);
  const avgAcceptableSeconds = metrics.acceptableScans
    ? `${(metrics.totalTimeToAcceptableMs / metrics.acceptableScans / 1000).toFixed(1)}s`
    : "No data";
  const topFailure = getTopReason(metrics.failuresByReason);
  const retakeCount = sumReasonCounts(metrics.retakesByReason);
  const needsBetterPhoto = sumCameraNeeds(metrics);
  const cameraOutcomeTotal = sumCameraTotals(metrics);
  const needsBetterPhotoRate = formatPercent(needsBetterPhoto, cameraOutcomeTotal);
  const manualCorrectionRate = formatPercent(metrics.manualCorrections, Math.max(metrics.acceptableScans, metrics.manualCorrections));
  const averageTrust = metrics.trustScores.count
    ? `${(metrics.trustScores.total / metrics.trustScores.count).toFixed(1)}/5`
    : "No data";
  const retakeRates = getRetakeRates(metrics);

  return (
    <section className="mt-5 rounded-[24px] border border-[var(--ds-accent-line)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Scan quality</p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight">Quality coach metrics</h2>
        </div>
        <span className="rounded-full bg-[var(--ds-accent-soft)] px-3 py-1 text-xs font-black text-[var(--ds-accent)]">
          {metrics.attempts} attempts
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <MetricTile label="First-pass success" value={firstPassRate} />
        <MetricTile label="Avg. acceptable time" value={avgAcceptableSeconds} />
        <MetricTile label="Retakes" value={`${retakeCount}`} />
        <MetricTile label="Manual correction rate" value={manualCorrectionRate} />
        <MetricTile label="Needs better photo" value={needsBetterPhotoRate} />
        <MetricTile label="Trust score" value={averageTrust} />
      </div>
      {topFailure ? (
        <p className="mt-3 text-sm font-semibold text-neutral-500">
          Top blocker: {formatReason(topFailure.reason)} ({topFailure.count}).
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold text-neutral-500">
          No quality issues logged yet.
        </p>
      )}
      {retakeRates.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {retakeRates.map(({ rate, reason }) => (
            <span key={reason} className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-600">
              {formatReason(reason)} retake {rate}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">{label}</p>
      <p className="mt-1 text-lg font-extrabold text-neutral-950">{value}</p>
    </div>
  );
}

function FilterSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-[var(--ds-accent)]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function getTopReason(counts: Record<ScanQualityFailureReason, number>) {
  return (Object.entries(counts) as [ScanQualityFailureReason, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }))[0] ?? null;
}

function sumReasonCounts(counts: Record<ScanQualityFailureReason, number>) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function sumCameraNeeds(metrics: ScanQualityMetrics) {
  return Object.values(metrics.needsBetterPhotoByCamera).reduce((sum, stats) => sum + stats.needsBetterPhoto, 0);
}

function sumCameraTotals(metrics: ScanQualityMetrics) {
  return Object.values(metrics.needsBetterPhotoByCamera).reduce((sum, stats) => sum + stats.total, 0);
}

function formatPercent(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "No data";
}

function getRetakeRates(metrics: ScanQualityMetrics) {
  return (Object.keys(metrics.failuresByReason) as ScanQualityFailureReason[])
    .filter((reason) => metrics.failuresByReason[reason] > 0)
    .map((reason) => ({
      rate: formatPercent(metrics.retakesByReason[reason], metrics.failuresByReason[reason]),
      reason,
    }));
}

function formatReason(reason: ScanQualityFailureReason) {
  return reason.replaceAll("_", " ");
}

function LookupCard({ lookup }: { lookup: Lookup }) {
  const title = lookup.result?.partName ?? (lookup.errorMessage ? "Lookup didn't land" : "Captured frame");
  const createdAt = new Date(lookup.createdAt).toLocaleString();
  const status = getStatusLabel(lookup);
  const readiness = getTrainingReadiness(lookup);

  return (
    <Link
      to={`/result/${lookup.id}`}
      state={scanStateFromLookup(lookup)}
      className="grid grid-cols-[88px_1fr] gap-3 rounded-[24px] border border-slate-200 bg-white p-3 text-slate-950 shadow-sm transition hover:border-blue-200"
    >
      <ScanThumb
        alt=""
        className="aspect-square w-full rounded-[18px] border border-neutral-200 bg-neutral-100 object-cover"
        src={lookup.frame.imageBase64}
      />
      <div className="min-w-0 py-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="truncate text-base font-extrabold tracking-tight">{title}</h2>
          {lookup.rating ? <span className="shrink-0 text-xs font-bold text-neutral-400">{lookup.rating === "up" ? "Helpful" : "Wrong"}</span> : null}
        </div>
        <p className="mt-1 truncate text-xs font-semibold text-neutral-400">{createdAt}</p>
        <p className="mt-3 text-sm font-semibold text-neutral-500">{status}</p>
        {lookup.jobId || lookup.vehicleContext?.technicianName ? (
          <p className="mt-2 truncate text-xs font-bold text-[var(--ds-accent)]">
            {lookup.vehicleContext?.jobTitle ?? "Shop job"}
            {lookup.vehicleContext?.technicianName ? ` / ${lookup.vehicleContext.technicianName}` : ""}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{lookup.scanCategory}</p>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${getReadinessChipClass(readiness.level)}`}>
            {readiness.label}
          </span>
        </div>
      </div>
    </Link>
  );
}

function getReadinessChipClass(level: ReturnType<typeof getTrainingReadiness>["level"]) {
  if (level === "ready") {
    return "bg-[var(--ds-ok-soft)] text-[var(--ds-ok-ink)]";
  }

  if (level === "not_ready") {
    return "bg-[var(--ds-warn-soft)] text-[var(--ds-warn-ink)]";
  }

  return "bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]";
}

function getStatusLabel(lookup: Lookup) {
  if (lookup.errorMessage) {
    return "Lookup didn't land";
  }

  if (!lookup.result) {
    return "Not analyzed";
  }

  if (lookup.result.safetyTriage === "needs_professional" || lookup.result.isSafetyCritical) {
    return "Safety check needed";
  }

  if (lookup.result.needsBetterPhoto || lookup.result.safetyTriage === "needs_better_photo") {
    return "Reshoot for a cleaner read";
  }

  return `${lookup.result.confidence} confidence`;
}

function matchesQuery(lookup: Lookup, query: string) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return true;
  }

  return normalizeText(
    [
      lookup.result?.partName,
      lookup.trainingLabel,
      lookup.correction,
      lookup.notes,
      lookup.scanCategory,
      lookup.jobId,
      lookup.orgId,
      lookup.vehicleContext?.bayOrRo,
      lookup.vehicleContext?.customerName,
      lookup.vehicleContext?.jobTitle,
      lookup.vehicleContext?.make,
      lookup.vehicleContext?.model,
      lookup.vehicleContext?.plate,
      lookup.vehicleContext?.symptom,
      lookup.vehicleContext?.technicianName,
      lookup.vehicleContext?.vin,
      lookup.vehicleContext?.year,
      lookup.result?.whatItDoes,
      ...(lookup.result?.visibleObservations ?? []),
      ...(lookup.result?.concerns ?? []),
    ].join(" "),
  ).includes(normalizedQuery);
}

function matchesCategory(lookup: Lookup, categoryFilter: ScanCategory | "all") {
  return categoryFilter === "all" || lookup.scanCategory === categoryFilter;
}

function matchesReviewStatus(lookup: Lookup, reviewFilter: TrainingStatus | "error" | "all") {
  if (reviewFilter === "all") {
    return true;
  }

  if (reviewFilter === "error") {
    return Boolean(lookup.errorMessage);
  }

  return lookup.trainingStatus === reviewFilter;
}

function matchesRating(lookup: Lookup, ratingFilter: Exclude<Rating, null> | "unrated" | "all") {
  if (ratingFilter === "all") {
    return true;
  }

  if (ratingFilter === "unrated") {
    return lookup.rating === null;
  }

  return lookup.rating === ratingFilter;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function mergeLookups(localLookups: Lookup[], cloudLookups: Lookup[]) {
  const byId = new Map<string, Lookup>();

  for (const lookup of cloudLookups) {
    byId.set(lookup.id, lookup);
  }

  for (const lookup of localLookups) {
    byId.set(lookup.id, lookup);
  }

  return [...byId.values()].sort((left, right) => getTimestamp(right.createdAt) - getTimestamp(left.createdAt));
}

function getTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function exportLookups(lookups: Lookup[]) {
  const blob = new Blob([`${JSON.stringify(lookups, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `deepspec-saved-scans-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
