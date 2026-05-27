import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { getDatasetExport, getLookups, getReviewQueueExport } from "../services/storage";
import { SCAN_CATEGORIES, type Confidence, type Lookup, type ScanCategory, type TrainingStatus } from "../types";

type CategoryFilter = "all" | ScanCategory;
type ConfidenceFilter = "all" | Confidence;
type StatusFilter = "all" | TrainingStatus | "error" | "not_analyzed";

export default function History() {
  const lookups = useMemo(() => getLookups(), []);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const visibleLookups = useMemo(() => filterLookups(lookups, {
    category: categoryFilter,
    confidence: confidenceFilter,
    query,
    status: statusFilter,
  }), [categoryFilter, confidenceFilter, lookups, query, statusFilter]);

  function handleExportDataset() {
    downloadJson(`deep-spec-dataset-${new Date().toISOString().slice(0, 10)}.json`, getDatasetExport(lookups));
  }

  function handleExportReviewQueue() {
    downloadJson(`deep-spec-review-queue-${new Date().toISOString().slice(0, 10)}.json`, getReviewQueueExport(lookups));
  }

  function downloadJson(filename: string, payload: unknown) {
    const exportJson = JSON.stringify(payload, null, 2);
    const url = URL.createObjectURL(new Blob([exportJson], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

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
          <>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button className="w-full" onClick={handleExportDataset}>
                Export dataset
              </Button>
              <Button className="w-full bg-neutral-900 shadow-none active:bg-neutral-800" onClick={handleExportReviewQueue}>
                Export review queue
              </Button>
            </div>
            <HistoryFilters
              category={categoryFilter}
              confidence={confidenceFilter}
              query={query}
              status={statusFilter}
              visibleCount={visibleLookups.length}
              totalCount={lookups.length}
              onCategoryChange={setCategoryFilter}
              onConfidenceChange={setConfidenceFilter}
              onQueryChange={setQuery}
              onStatusChange={setStatusFilter}
            />
            {visibleLookups.length > 0 ? (
              <div className="mt-4 space-y-3">
                {visibleLookups.map((lookup) => (
                  <LookupCard key={lookup.id} lookup={lookup} />
                ))}
              </div>
            ) : (
              <section className="mt-4 rounded-[24px] border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm">
                <p className="text-sm font-bold text-[var(--ds-accent)]">No scans match those filters</p>
                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  Clear one filter or search a different part, label, category, or note.
                </p>
              </section>
            )}
          </>
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

function HistoryFilters({
  category,
  confidence,
  onCategoryChange,
  onConfidenceChange,
  onQueryChange,
  onStatusChange,
  query,
  status,
  totalCount,
  visibleCount,
}: {
  category: CategoryFilter;
  confidence: ConfidenceFilter;
  onCategoryChange: (value: CategoryFilter) => void;
  onConfidenceChange: (value: ConfidenceFilter) => void;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  query: string;
  status: StatusFilter;
  totalCount: number;
  visibleCount: number;
}) {
  return (
    <section className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold text-neutral-900">Review filters</h2>
        <p className="text-xs font-bold text-neutral-400">
          {visibleCount} of {totalCount}
        </p>
      </div>
      <label className="mt-3 block">
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Search scans</span>
        <input
          className="mt-2 h-11 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 text-sm font-semibold text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[var(--ds-accent)]"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Part, label, note, category"
          value={query}
        />
      </label>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FilterSelect
          label="Category"
          value={category}
          onChange={(value) => onCategoryChange(value as CategoryFilter)}
          options={[
            ["all", "All categories"],
            ...SCAN_CATEGORIES.map((categoryName) => [categoryName, categoryName] as const),
          ]}
        />
        <FilterSelect
          label="Review status"
          value={status}
          onChange={(value) => onStatusChange(value as StatusFilter)}
          options={[
            ["all", "All statuses"],
            ["raw_unreviewed", "Raw"],
            ["user_confirmed", "Confirmed"],
            ["user_corrected", "Corrected"],
            ["error", "AI error"],
            ["not_analyzed", "Not analyzed"],
          ]}
        />
        <FilterSelect
          label="Confidence"
          value={confidence}
          onChange={(value) => onConfidenceChange(value as ConfidenceFilter)}
          options={[
            ["all", "Any confidence"],
            ["high", "High"],
            ["medium", "Medium"],
            ["low", "Low"],
          ]}
        />
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">{label}</span>
      <select
        className="mt-2 h-11 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 text-sm font-semibold capitalize text-neutral-900 outline-none focus:border-[var(--ds-accent)]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
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

function filterLookups(
  lookups: Lookup[],
  filters: {
    category: CategoryFilter;
    confidence: ConfidenceFilter;
    query: string;
    status: StatusFilter;
  },
) {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return lookups.filter((lookup) => (
    matchesCategory(lookup, filters.category) &&
    matchesConfidence(lookup, filters.confidence) &&
    matchesStatus(lookup, filters.status) &&
    matchesQuery(lookup, normalizedQuery)
  ));
}

function matchesCategory(lookup: Lookup, category: CategoryFilter) {
  return category === "all" || lookup.scanCategory === category;
}

function matchesConfidence(lookup: Lookup, confidence: ConfidenceFilter) {
  return confidence === "all" || lookup.result?.confidence === confidence;
}

function matchesStatus(lookup: Lookup, status: StatusFilter) {
  if (status === "all") return true;
  if (status === "error") return Boolean(lookup.errorMessage);
  if (status === "not_analyzed") return !lookup.result && !lookup.errorMessage;
  return lookup.trainingStatus === status;
}

function matchesQuery(lookup: Lookup, query: string) {
  if (!query) return true;

  return [
    lookup.result?.partName,
    lookup.trainingLabel,
    lookup.scanCategory,
    lookup.trainingStatus.replaceAll("_", " "),
    lookup.notes,
    lookup.correction,
    lookup.errorMessage,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLowerCase().includes(query));
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
