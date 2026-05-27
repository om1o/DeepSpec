import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { MAX_SAVED_LOOKUPS, getLookups } from "../services/storage";
import { SCAN_CATEGORIES, type Lookup, type Rating, type ScanCategory, type TrainingStatus } from "../types";

export default function History() {
  const lookups = useMemo(() => getLookups(), []);
  const [query, setQuery] = useState("");
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
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-12 w-36 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Saved scans</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/early-access" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
              Join
            </Link>
            <Link to="/scan" className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white shadow-sm">
              Scan
            </Link>
          </div>
        </header>

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
                Local storage is at the {MAX_SAVED_LOOKUPS}-scan cap. Export before replacing older scans.
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
            <p className="mt-2 text-sm leading-6 text-neutral-500">Clear the filters to see the full saved scan list.</p>
          </section>
        ) : (
          <section className="mt-8 rounded-[24px] border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-[var(--ds-accent)]">No saved scans yet</p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">Scan your first part</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-500">
              Deep Spec will save the photo, AI result, rating, correction, and notes on this device.
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

function LookupCard({ lookup }: { lookup: Lookup }) {
  const title = lookup.result?.partName ?? (lookup.errorMessage ? "AI lookup failed" : "Captured frame");
  const createdAt = new Date(lookup.createdAt).toLocaleString();
  const status = getStatusLabel(lookup);

  return (
    <Link
      to={`/result/${lookup.id}`}
      className="grid grid-cols-[88px_1fr] gap-3 rounded-[24px] border border-slate-200 bg-white p-3 text-slate-950 shadow-sm transition hover:border-blue-200"
    >
      <img
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
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{lookup.scanCategory}</p>
      </div>
    </Link>
  );
}

function getStatusLabel(lookup: Lookup) {
  if (lookup.errorMessage) {
    return "AI error saved";
  }

  if (!lookup.result) {
    return "Not analyzed";
  }

  if (lookup.result.safetyTriage === "needs_professional" || lookup.result.isSafetyCritical) {
    return "Professional verification needed";
  }

  if (lookup.result.needsBetterPhoto || lookup.result.safetyTriage === "needs_better_photo") {
    return "Better photo needed";
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

function exportLookups(lookups: Lookup[]) {
  const blob = new Blob([`${JSON.stringify(lookups, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `deepspec-saved-scans-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
