import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import {
  ensureDefaultOrganization,
  getCurrentOrganization,
  getShopFeedbackPermission,
  getShopMetrics,
  getShopJobs,
  searchShopJobs,
  setShopLearningOptIn,
} from "../services/shop";
import type { ShopJob } from "../types";

export default function Shop() {
  const [organization] = useState(() => ensureDefaultOrganization());
  const [jobs, setJobs] = useState<ShopJob[]>(() => getShopJobs());
  const [query, setQuery] = useState("");
  const [permission, setPermission] = useState(() => getShopFeedbackPermission(organization.id));
  const filteredJobs = useMemo(() => searchShopJobs(query, jobs), [jobs, query]);
  const metrics = useMemo(() => getShopMetrics(jobs, undefined, permission), [jobs, permission]);

  function handleLearningToggle() {
    const next = setShopLearningOptIn(organization.id, !permission.learningOptIn);
    setPermission(next);
    setJobs(getShopJobs());
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <img src="/brand/deepspec-logo.webp" alt="Deep Spec" className="h-12 w-36 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
            <p className="mt-3 text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Shop mode</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">Work queue</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">{getCurrentOrganization().name}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Link to="/history" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
              History
            </Link>
            <Link to="/scan" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
              Scan
            </Link>
            <Link to="/shop/new" className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white shadow-sm">
              New job
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-3 md:grid-cols-4">
          <MetricTile label="Open jobs" value={String(metrics.totalJobs)} />
          <MetricTile label="Shop scans" value={String(metrics.scansTotal)} />
          <MetricTile label="Useful rate" value={metrics.usefulRate} />
          <MetricTile label="Correction rate" value={metrics.correctionRate} />
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black tracking-tight">Technician queue</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">Needs review, confirmed, and corrected jobs stay searchable.</p>
              </div>
              <label className="min-w-[220px]">
                <span className="sr-only">Search shop jobs</span>
                <input
                  className="w-full rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--ds-accent)]"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search VIN, RO, customer, symptom"
                  value={query}
                />
              </label>
            </div>

            {filteredJobs.length ? (
              <div className="mt-4 divide-y divide-slate-100">
                {filteredJobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-[8px] border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                <p className="text-sm font-bold text-[var(--ds-accent)]">{jobs.length ? "No jobs match" : "No shop jobs yet"}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">Create a job before scanning so the answer has vehicle and complaint context.</p>
                <Button className="mt-4" onClick={() => window.location.assign("/shop/new")}>
                  New job
                </Button>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black tracking-tight">Accuracy feedback</h2>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniMetric label="Review" value={String(metrics.needsReviewScans)} />
                <MiniMetric label="Confirmed" value={String(metrics.confirmedScans)} />
                <MiniMetric label="Corrected" value={String(metrics.correctedScans)} />
              </div>
              <button
                aria-pressed={permission.learningOptIn}
                className={`mt-4 w-full rounded-[8px] px-4 py-3 text-left text-sm font-bold ${
                  permission.learningOptIn
                    ? "bg-[var(--ds-ok-soft)] text-[var(--ds-ok-ink)]"
                    : "bg-slate-100 text-slate-700"
                }`}
                onClick={handleLearningToggle}
                type="button"
              >
                {permission.learningOptIn
                  ? `DeepSpec learned from ${metrics.learnedCorrections} shop corrections.`
                  : "Shop corrections stay private. Tap to opt in to learning."}
              </button>
            </section>

            <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black tracking-tight">Missed categories</h2>
              {metrics.topMissedCategories.length ? (
                <div className="mt-3 space-y-2">
                  {metrics.topMissedCategories.map((item) => (
                    <div key={item.category} className="flex items-center justify-between gap-3 rounded-[8px] bg-slate-50 px-3 py-2 text-sm font-bold">
                      <span className="capitalize">{item.category}</span>
                      <span>{item.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-500">No corrected scans yet.</p>
              )}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function JobRow({ job }: { job: ShopJob }) {
  return (
    <article className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-lg font-black tracking-tight">{job.title}</h3>
          <StatusPill label={job.reviewStatus} />
          <StatusPill label={job.status} quiet />
        </div>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {job.year} {job.make} {job.model} / {job.technicianName}
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{job.symptom}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-400">
          {job.vin ? <span>VIN {job.vin}</span> : <span>VIN needed</span>}
          {job.bayOrRo ? <span>RO {job.bayOrRo}</span> : null}
          <span>{job.scanIds.length} scan{job.scanIds.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <Link to={`/scan?jobId=${encodeURIComponent(job.id)}`} className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white">
          Scan
        </Link>
        <Link to={`/shop/jobs/${encodeURIComponent(job.id)}`} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
          Open
        </Link>
      </div>
    </article>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-slate-50 p-3">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function StatusPill({ label, quiet = false }: { label: string; quiet?: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black capitalize ${quiet ? "bg-slate-100 text-slate-500" : "bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]"}`}>
      {label.replaceAll("_", " ")}
    </span>
  );
}
