import { type FormEvent, type MouseEventHandler, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { JobInspectionHandoff, JobInspectionThumbnail } from "../components/shop/JobInspectionHandoff";
import Button from "../components/ui/Button";
import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { assertJobInspectionContextCurrent, readJobInspectionContext } from "../services/jobInspectionHandoff";
import { downloadTextFile } from "../services/report";
import { subscribeToLookupChanges } from "../services/storage";
import {
  buildCustomerJobReport,
  getShopMetrics,
  subscribeShopJobs,
  updateShopJob,
} from "../services/shop";
import type { Lookup, ShopJob as ShopJobRecord, ShopJobStatus } from "../types";
import type { JobInspectionContext } from "../types/jobInspectionHandoff";

export default function ShopJob() {
  const { jobId } = useParams();
  const scope = getAccountScope();
  return <ShopJobView key={JSON.stringify([jobId, scope.userId, scope.generation])} jobId={jobId} scope={scope} />;
}

function ShopJobView({ jobId, scope }: { jobId?: string; scope: AccountScope }) {
  const [saved, setSaved] = useState(() => loadContext(jobId, scope));
  const context = saved.context;
  const job = context?.job;
  const [baseFields, setBaseFields] = useState(() => editableFields(job));
  const [draftVin, setDraftVin] = useState(job?.vin ?? "");
  const [draftStatus, setDraftStatus] = useState<ShopJobStatus>(job?.status ?? "open");
  const [draftNotes, setDraftNotes] = useState(job?.notes ?? "");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const scans = context?.scans ?? [];
  const metrics = job ? getShopMetrics([job], scans) : null;
  const draftFields = { vin: draftVin, status: draftStatus, notes: draftNotes };
  const dirty = JSON.stringify(draftFields) !== JSON.stringify(baseFields);
  const changed = JSON.stringify(editableFields(job)) !== JSON.stringify(baseFields);
  const blocked = Boolean(saved.error || saved.missing);

  useEffect(() => {
    if (!scope.userId || !isAccountScopeCurrent(scope)) return;
    const refresh = () => {
      const next = loadContext(jobId, scope);
      // A deleted/unreadable job must not erase entered form text or masquerade
      // as an empty job. Keep the last visible snapshot, with all actions blocked.
      setSaved((previous) => ({ ...next, context: next.context ?? previous.context }));
    };
    const stopJobs = subscribeShopJobs(refresh, scope);
    const stopLookups = subscribeToLookupChanges(refresh);
    return () => { stopJobs(); stopLookups(); };
  }, [jobId, scope]);

  function refresh() {
    const next = loadContext(jobId, scope);
    setSaved((previous) => ({ ...next, context: next.context ?? previous.context }));
  }

  function freshContext() {
    if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen this job before continuing.");
    const latest = jobId ? readJobInspectionContext(jobId, scope) : null;
    if (!latest) throw new Error("This job is no longer saved on this device. Your entered text has been kept on this page.");
    assertJobInspectionContextCurrent(latest, scope);
    return latest;
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const latest = freshContext();
      if (JSON.stringify(editableFields(latest.job)) !== JSON.stringify(baseFields)) {
        setSaved({ context: latest, missing: false, error: "" });
        throw new Error("The saved job fields changed elsewhere. Your entered text is still here. Review the saved fields before saving.");
      }
      const result = updateShopJob(latest.job.id, draftFields);
      if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen this job before continuing.");
      if (!result.ok) throw new Error(result.message);
      if (!result.value) throw new Error("The job save was not acknowledged. Your entered text is still here.");
      const fields = editableFields(result.value);
      setBaseFields(fields); setDraftVin(fields.vin); setDraftStatus(fields.status); setDraftNotes(fields.notes);
      refresh();
      setStatusMessage("Job updated on this device. Existing scan snapshots retain their saved vehicle details.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The job could not be saved. Your entered text is still here.");
    }
  }

  function handleReportExport() {
    try {
      const latest = freshContext();
      if (dirty || changed || blocked) throw new Error("Save or review the pending job changes before exporting.");
      if (!context) throw new Error("Reopen this job before exporting.");
      assertJobInspectionContextCurrent(context, scope);
      downloadTextFile(`deepspec-shop-report-${latest.job.id}.txt`, buildCustomerJobReport(latest.job, latest.scans));
      setStatusMessage("Quick text summary downloaded. It does not include the full inspection photos or history.");
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : "The summary could not be exported. Refresh the job."); }
  }

  function useSavedFields() {
    try {
      const latest = freshContext();
      const fields = editableFields(latest.job);
      setSaved({ context: latest, missing: false, error: "" });
      setBaseFields(fields); setDraftVin(fields.vin); setDraftStatus(fields.status); setDraftNotes(fields.notes);
      setStatusMessage("Saved fields loaded. No job record was changed.");
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : "The saved job could not be read."); }
  }

  if (!isAccountScopeCurrent(scope)) return <main className="p-5"><p role="alert">Account changed. Job details are hidden. Reopen the job.</p><Link to="/shop">Return to jobs</Link></main>;
  if (!jobId || !job || !context) {
    return <main className="p-5"><p role="alert">{saved.error || "This job is not available on this device."}</p><Button onClick={refresh}>Retry reading job</Button><Link to="/shop" className="ml-4">Return to jobs</Link></main>;
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
            <Link to={`/scan?jobId=${encodeURIComponent(job.id)}`} aria-disabled={blocked || dirty || changed} onClick={(event) => { try { if (blocked || dirty || changed) throw new Error("Save or review the pending job changes before starting a scan."); freshContext(); } catch (error) { event.preventDefault(); setStatusMessage(error instanceof Error ? error.message : "Refresh the job first."); } }} className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white">
              Scan part
            </Link>
          </div>
        </header>

        {statusMessage ? (
          <div role="status" className="mt-4 rounded-[8px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
            {statusMessage}
          </div>
        ) : null}
        {blocked ? <div role="alert" className="mt-4 rounded-lg border border-amber-300 p-4"><p>{saved.error || "This job is no longer saved on this device."} The last displayed snapshot and your entered text are retained; actions are blocked.</p><Button variant="ghost" onClick={refresh}>Retry reading job</Button></div> : null}

        <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black tracking-tight">Vehicle and complaint</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Detail label="Vehicle" value={`${job.year} ${job.make} ${job.model}`} />
                <Detail label="VIN" value={job.vin || "Missing"} warn={!job.vin} />
                <Detail label="Mileage" value={job.mileage ? `${job.mileage} ${job.mileageUnit ?? "unit unknown"}` : "Not provided"} />
                <Detail label="Engine" value={job.engine || "Not provided"} />
                <Detail label="Customer" value={job.customerName || "Not provided"} />
                <Detail label="Bay / RO" value={job.bayOrRo || "Not provided"} />
              </div>
              <div className="mt-4 rounded-[8px] bg-slate-50 px-3 py-3">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Complaint</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{job.symptom}</p>
              </div>
            </section>

            <JobInspectionHandoff context={context} disabled={blocked || dirty || changed} />

            <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black tracking-tight">Scans and corrections</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">Mark useful answers and record corrections. Feedback does not verify a diagnosis.</p>
                </div>
                <Button type="button" disabled={blocked || dirty || changed} onClick={handleReportExport}>
                  Quick text summary
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">The text summary omits full photos, component maps and detailed evidence history. Use Inspection handoff for a report with photos. The text summary can include customer and technician details; review it before sharing.</p>

              {scans.length ? (
                <div className="mt-4 grid gap-3">
                  {scans.map((scan) => (
                    <ScanRow key={scan.id} scan={scan} onOpen={(event) => { try { if (blocked || dirty || changed) throw new Error("Save or review the pending job changes before opening a scan."); assertJobInspectionContextCurrent(context, scope); } catch (error) { event.preventDefault(); setStatusMessage(error instanceof Error ? error.message : "Refresh this job first."); } }} />
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-[8px] border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                  <p className="text-sm font-bold text-[var(--ds-accent)]">No available scans attached</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">Start a scan from this job so DeepSpec can keep the answer, feedback, and report together.</p>
                  <Link to={`/scan?jobId=${encodeURIComponent(job.id)}`} onClick={(event) => { try { if (blocked || dirty || changed) throw new Error("Save or review the pending job changes before starting a scan."); freshContext(); } catch (error) { event.preventDefault(); setStatusMessage(error instanceof Error ? error.message : "Refresh this job first."); } }} className="mt-4 inline-flex rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white">
                    Scan part
                  </Link>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <form className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleUpdate}>
              <h2 className="text-lg font-black tracking-tight">Update job</h2>
              {dirty ? <p className="mt-2 text-sm">Unsaved job edits are on this page. Save or copy them before leaving.</p> : null}
              {changed ? <div role="alert" className="mt-3 space-y-2 rounded-lg border border-amber-300 p-3 text-sm"><p>Saved VIN, status or notes changed elsewhere. Your entered fields have not been overwritten.</p><details><summary className="cursor-pointer py-2 font-bold">Review saved fields</summary><p>VIN: {job.vin || "Not provided"}</p><p>Status: {job.status.replaceAll("_", " ")}</p><p className="whitespace-pre-wrap break-words">Notes: {job.notes || "None"}</p></details><p>Copy your entered text first if you want to keep it. Loading saved fields replaces the form only.</p><Button type="button" variant="ghost" disabled={blocked} onClick={useSavedFields}>Replace form with saved fields</Button></div> : null}
              <label className="mt-4 block">
                <span className="text-sm font-bold text-slate-700">VIN</span>
                <input
                  className="mt-1 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-sm font-semibold uppercase outline-none focus:border-[var(--ds-accent)]"
                  onChange={(event) => setDraftVin(event.target.value)}
                  maxLength={17}
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
                  maxLength={500}
                  value={draftNotes}
                />
              </label>
              <Button className="mt-5 w-full" type="submit" disabled={blocked || changed}>
                Save job
              </Button>
            </form>

            {metrics ? (
              <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black tracking-tight">Review activity</h2>
                <p className="mt-2 text-xs text-slate-500">User feedback on available job scans; not measured diagnostic accuracy or vehicle safety.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Metric label="Needs review" value={String(metrics.needsReviewScans)} />
                  <Metric label="Marked useful" value={String(metrics.confirmedScans)} />
                  <Metric label="Corrected" value={String(metrics.correctedScans)} />
                  <Metric label="Marked useful rate" value={metrics.usefulRate} />
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

function ScanRow({ scan, onOpen }: { scan: Lookup; onOpen: MouseEventHandler<HTMLAnchorElement> }) {
  const title = scan.correction?.trim() || scan.result?.partName || scan.errorMessage || "Captured part";

  return (
    <Link
      to={`/result/${encodeURIComponent(scan.id)}`}
      onClick={onOpen}
      className="grid grid-cols-[72px_1fr] gap-3 rounded-[8px] border border-slate-200 bg-white p-3 transition hover:border-blue-200"
    >
      <JobInspectionThumbnail scan={scan} alt="" className="aspect-square rounded-[8px] border border-slate-200 bg-slate-100 object-contain" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-black tracking-tight">{title}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black capitalize text-slate-500">
            {scan.reviewStatus === "confirmed" ? "Marked useful" : (scan.reviewStatus ?? "needs_review").replaceAll("_", " ")}
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

function editableFields(job?: ShopJobRecord) { return { vin: job?.vin ?? "", status: job?.status ?? "open" as ShopJobStatus, notes: job?.notes ?? "" }; }
function loadContext(jobId: string | undefined, scope: AccountScope): { context: JobInspectionContext | null; missing: boolean; error: string } {
  try {
    if (!jobId) return { context: null, missing: true, error: "" };
    const context = readJobInspectionContext(jobId, scope);
    return { context, missing: !context, error: "" };
  } catch (error) { return { context: null, missing: false, error: error instanceof Error ? error.message : "The job could not be read safely. Retry before continuing." }; }
}
