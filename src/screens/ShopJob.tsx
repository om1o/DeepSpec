import { type FormEvent, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import Button from "../components/ui/Button";
import ScanThumb from "../components/ui/ScanThumb";
import { downloadTextFile } from "../services/report";
import {
  buildCustomerJobReport,
  getShopJob,
  getShopJobScans,
  getShopMetrics,
  updateShopJob,
} from "../services/shop";
import type { Lookup, ShopJob as ShopJobRecord, ShopJobStatus } from "../types";

export default function ShopJob() {
  const { jobId } = useParams();
  const [job, setJob] = useState<ShopJobRecord | null>(() => (jobId ? getShopJob(jobId) : null));
  const [draftVin, setDraftVin] = useState(job?.vin ?? "");
  const [draftStatus, setDraftStatus] = useState<ShopJobStatus>(job?.status ?? "open");
  const [draftNotes, setDraftNotes] = useState(job?.notes ?? "");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const scans = useMemo(() => (job ? getShopJobScans(job) : []), [job]);
  const metrics = useMemo(() => (job ? getShopMetrics([job], scans) : null), [job, scans]);

  if (!jobId || !job) {
    return <Navigate to="/shop" replace />;
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job) {
      return;
    }

    const result = updateShopJob(job.id, {
      notes: draftNotes,
      status: draftStatus,
      vin: draftVin,
    });
    if (!result.ok) {
      setStatusMessage(result.message);
      return;
    }

    if (result.value) {
      setJob(result.value);
      setStatusMessage("Job updated.");
    }
  }

  function handleReportExport() {
    if (!job) {
      return;
    }

    downloadTextFile(`deepspec-shop-report-${job.id}.txt`, buildCustomerJobReport(job, scans));
    setStatusMessage("Customer report exported.");
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Shop job</p>
            <h1 className="mt-1 truncate text-3xl font-black tracking-tight">{job.title}</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {job.year} {job.make} {job.model} / {job.technicianName}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Link to="/shop" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
              Queue
            </Link>
            <Link to={`/scan?jobId=${encodeURIComponent(job.id)}`} className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white">
              Scan part
            </Link>
          </div>
        </header>

        {statusMessage ? (
          <div className="mt-4 rounded-[8px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
            {statusMessage}
          </div>
        ) : null}

        <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black tracking-tight">Vehicle and complaint</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Detail label="Vehicle" value={`${job.year} ${job.make} ${job.model}`} />
                <Detail label="VIN" value={job.vin || "Missing"} warn={!job.vin} />
                <Detail label="Mileage" value={job.mileage || "Not provided"} />
                <Detail label="Engine" value={job.engine || "Not provided"} />
                <Detail label="Customer" value={job.customerName || "Not provided"} />
                <Detail label="Bay / RO" value={job.bayOrRo || "Not provided"} />
              </div>
              <div className="mt-4 rounded-[8px] bg-slate-50 px-3 py-3">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Complaint</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{job.symptom}</p>
              </div>
            </section>

            <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black tracking-tight">Scans and corrections</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">Confirm useful answers, correct misses, then export a report.</p>
                </div>
                <Button type="button" onClick={handleReportExport}>
                  Export report
                </Button>
              </div>

              {scans.length ? (
                <div className="mt-4 grid gap-3">
                  {scans.map((scan) => (
                    <ScanRow key={scan.id} scan={scan} />
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-[8px] border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                  <p className="text-sm font-bold text-[var(--ds-accent)]">No scans attached</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">Start a scan from this job so DeepSpec can keep the answer, feedback, and report together.</p>
                  <Link to={`/scan?jobId=${encodeURIComponent(job.id)}`} className="mt-4 inline-flex rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white">
                    Scan part
                  </Link>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <form className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleUpdate}>
              <h2 className="text-lg font-black tracking-tight">Update job</h2>
              <label className="mt-4 block">
                <span className="text-sm font-bold text-slate-700">VIN</span>
                <input
                  className="mt-1 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-sm font-semibold uppercase outline-none focus:border-[var(--ds-accent)]"
                  onChange={(event) => setDraftVin(event.target.value)}
                  value={draftVin}
                />
              </label>
              <label className="mt-4 block">
                <span className="text-sm font-bold text-slate-700">Status</span>
                <select
                  className="mt-1 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--ds-accent)]"
                  onChange={(event) => setDraftStatus(event.target.value as ShopJobStatus)}
                  value={draftStatus}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="ready_for_review">Ready for review</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className="mt-4 block">
                <span className="text-sm font-bold text-slate-700">Notes</span>
                <textarea
                  className="mt-1 min-h-28 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--ds-accent)]"
                  onChange={(event) => setDraftNotes(event.target.value)}
                  value={draftNotes}
                />
              </label>
              <Button className="mt-5 w-full" type="submit">
                Save job
              </Button>
            </form>

            {metrics ? (
              <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black tracking-tight">Job accuracy</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Metric label="Needs review" value={String(metrics.needsReviewScans)} />
                  <Metric label="Confirmed" value={String(metrics.confirmedScans)} />
                  <Metric label="Corrected" value={String(metrics.correctedScans)} />
                  <Metric label="Useful rate" value={metrics.usefulRate} />
                </div>
              </section>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}

function Detail({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-[8px] px-3 py-3 ${warn ? "bg-[var(--ds-warn-soft)]" : "bg-slate-50"}`}>
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className={`mt-1 text-sm font-bold ${warn ? "text-[var(--ds-warn-ink)]" : "text-slate-800"}`}>{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-slate-50 p-3">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function ScanRow({ scan }: { scan: Lookup }) {
  const title = scan.correction?.trim() || scan.result?.partName || scan.errorMessage || "Captured part";

  return (
    <Link
      to={`/result/${scan.id}`}
      className="grid grid-cols-[72px_1fr] gap-3 rounded-[8px] border border-slate-200 bg-white p-3 transition hover:border-blue-200"
    >
      <ScanThumb alt="" className="aspect-square rounded-[8px] border border-slate-200 bg-slate-100 object-cover" src={scan.frame.imageBase64} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-black tracking-tight">{title}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black capitalize text-slate-500">
            {(scan.reviewStatus ?? "needs_review").replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          Fitment: {scan.result?.fitmentConfidence ?? "needs_vehicle_context"}
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600">
          {scan.result?.whatItDoes ?? scan.errorMessage ?? "Open to review this scan."}
        </p>
      </div>
    </Link>
  );
}
