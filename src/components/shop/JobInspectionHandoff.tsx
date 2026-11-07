import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { isVehicleFieldConfirmed, normalizeVehicleContext } from "../../lib/vehicleContext";
import { assertJobInspectionContextCurrent } from "../../services/jobInspectionHandoff";
import type { Lookup } from "../../types";
import type { JobInspectionContext } from "../../types/jobInspectionHandoff";
import { InspectionReportExport } from "../result/InspectionReportExport";
import ScanThumb from "../ui/ScanThumb";

type Props = { context: JobInspectionContext; disabled?: boolean };

/** An explicit job member selection, never a newest-scan or same-vehicle inference. */
export function JobInspectionHandoff({ context, disabled = false }: Props) {
  const [scope] = useState(getAccountScope);
  const [params, setParams] = useSearchParams();
  const [message, setMessage] = useState("");
  const requestedId = params.get("overview") ?? "";
  const available = context.scans.filter((scan) => !context.conflictingScanIds.includes(scan.id));
  const eligible = available.filter((scan) => Boolean(firstOriginal(scan)));
  const selected = eligible.find((scan) => scan.id === requestedId);
  const missingOriginals = available.filter((scan) => !firstOriginal(scan));

  function assertCurrent() {
    if (disabled) throw new Error("Save or review the pending job changes before opening this inspection.");
    if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen the job before choosing an inspection.");
    assertJobInspectionContextCurrent(context, scope);
  }

  function select(id: string) {
    try {
      assertCurrent();
      if (id && !eligible.some((scan) => scan.id === id)) throw new Error("That inspection is no longer available in this job. Refresh the job and choose again.");
      const next = new URLSearchParams(params);
      if (id) next.set("overview", id); else next.delete("overview");
      setParams(next, { replace: true });
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The job selection could not be verified. Refresh the job."); }
  }

  if (!isAccountScopeCurrent(scope)) return <p role="alert">Account changed. Job inspections are hidden; reopen the job.</p>;
  return <section aria-label="Job inspection handoff" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-black tracking-tight">Inspection handoff</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Choose the saved inspection that should start the report. Its linked evidence can be included; selecting it does not combine every scan in this job or confirm that they show the same vehicle.</p>
    <p className="mt-2 text-xs text-slate-500">This list uses job records saved in this browser. Cloud history is not searched here. Missing details stay unknown.</p>
    {context.unavailableScanIds.length ? <p role="alert" className="mt-3 break-words text-sm">Unavailable on this device: {context.unavailableScanIds.join(", ")}. These scans cannot be selected.</p> : null}
    {context.conflictingScanIds.length ? <p role="alert" className="mt-3 break-words text-sm">Conflicting job membership: {context.conflictingScanIds.join(", ")}. These scans name a different job and are excluded from selection.</p> : null}
    {missingOriginals.length ? <p role="alert" className="mt-3 break-words text-sm">First original unavailable: {missingOriginals.map((scan) => scan.id).join(", ")}. No other photo or cutout is substituted.</p> : null}
    <label className="mt-4 block text-sm font-bold">
      Overview inspection
      <select className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2" value={selected?.id ?? ""} disabled={disabled || !eligible.length} onChange={(event) => select(event.target.value)}>
        <option value="">Choose an inspection…</option>
        {eligible.map((scan) => <option key={scan.id} value={scan.id}>{scanTitle(scan)} — saved {displayDate(scan.createdAt)} — {scan.id}</option>)}
      </select>
    </label>
    {!eligible.length ? <p className="mt-3 text-sm">No available overview inspection can be selected. Save a scan from this job or restore its missing original first.</p> : null}
    {requestedId && !selected ? <p role="alert" className="mt-3 text-sm">The selected inspection is no longer an available member of this job. Choose an available inspection; no replacement was selected automatically.</p> : null}
    {disabled ? <p className="mt-3 text-sm">Save or review the pending job changes before preparing the handoff.</p> : null}
    {message ? <p role="alert" className="mt-3 text-sm">{message}</p> : null}
    {selected ? <div className="mt-4 space-y-3" aria-label="Selected overview inspection">
      <div className="flex flex-col gap-4 sm:flex-row">
        <ScanThumb src={firstOriginal(selected)} alt={`First original of ${scanTitle(selected)}`} className="h-32 w-40 max-w-full rounded-lg border border-slate-200 object-contain" />
        <div className="min-w-0 flex-1 text-sm">
          <h3 className="font-bold">{scanTitle(selected)}</h3>
          <p className="mt-1">Saved {displayDate(selected.createdAt)}. This is the saved date, not a verified photo exposure date.</p>
          <p className="mt-1 break-words">Saved vehicle facts: {savedVehicleFacts(selected)}</p>
          <p className="mt-1 text-xs">These are the facts retained with this scan; current job edits do not rewrite them.</p>
        </div>
      </div>
      <VehicleDifference context={context} scan={selected} />
      <Link className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-4 text-sm font-bold" aria-disabled={disabled} to={`/result/${encodeURIComponent(selected.id)}`} onClick={(event) => {
        try { assertCurrent(); } catch (error) { event.preventDefault(); setMessage(error instanceof Error ? error.message : "Refresh this job before opening the inspection."); }
      }}>Open this inspection</Link>
      <p className="text-xs text-slate-500">Use your browser’s Back action to return to this job and its selected overview.</p>
      <InspectionReportExport lookupId={selected.id} jobContext={context} disabled={disabled} />
    </div> : null}
  </section>;
}

export function JobInspectionThumbnail({ scan, alt = "", className }: { scan: Lookup; alt?: string; className?: string }) {
  return <ScanThumb src={firstOriginal(scan)} alt={alt} className={className} />;
}

function firstOriginal(scan: Lookup): string | undefined {
  const frame = scan.photos === undefined ? scan.frame : scan.photos[0];
  return typeof frame?.imageBase64 === "string" && frame.imageBase64.trim() ? frame.imageBase64 : undefined;
}

function scanTitle(scan: Lookup) { return scan.inspection?.confirmedPartName || scan.correction?.trim() || scan.result?.partName || "Unidentified scan"; }
function displayDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "date unavailable"; }
function savedVehicleFacts(scan: Lookup) {
  const vehicle = normalizeVehicleContext(scan.vehicleContext);
  if (!vehicle) return "No vehicle details retained; same vehicle is unconfirmed.";
  const facts = (["year", "make", "model", "engine"] as const).flatMap((field) => vehicle[field] ? [`${field}: ${vehicle[field]} (${isVehicleFieldConfirmed(vehicle, field) ? "user confirmed" : "supplied, unconfirmed"})`] : []);
  if (vehicle.mileage) facts.push(`mileage: ${vehicle.mileage} ${vehicle.mileageUnit ?? "unit unknown"}`);
  return facts.join("; ") || "No vehicle identity details retained; same vehicle is unconfirmed.";
}
function VehicleDifference({ context, scan }: { context: JobInspectionContext; scan: Lookup }) {
  const saved = normalizeVehicleContext(scan.vehicleContext), job = normalizeVehicleContext(context.job);
  const different = (["vin", "year", "make", "model", "engine"] as const).filter((field) => {
    const first = suppliedFact(saved?.[field]), second = suppliedFact(job?.[field]);
    return Boolean(first && second && first !== second);
  });
  return different.length
    ? <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">Saved vehicle details differ from this job: {different.join(", ")}. Review the originals and vehicle identity before handoff; membership does not resolve this difference.</p>
    : <p className="text-sm text-slate-600">Job membership and matching or missing vehicle details do not establish that this inspection shows the same vehicle.</p>;
}
function suppliedFact(value: unknown) {
  const result = typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
  return /^(?:unknown|not known|unsure|not sure|n\/?a|not provided|not supplied)$/.test(result) ? "" : result;
}
