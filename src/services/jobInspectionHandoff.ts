import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeVehicleContext, providerVehicleContext } from "../lib/vehicleContext";
import type { InspectionReportSnapshot } from "../types/inspectionReport";
import type { JobInspectionContext, JobInspectionReportScope } from "../types/jobInspectionHandoff";
import { readShopJob } from "./shop";
import { readLookups } from "./storage";

const fields = ["vin", "year", "make", "model", "engine"] as const;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value) && value !== "." && value !== "..";
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const issued = new WeakMap<JobInspectionContext, { scope: AccountScope; signature: string }>();
const changed = "The job or its saved scan membership changed. Reopen the handoff and choose its overview again.";
function requireScope(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen the job in the account that owns it.");
}

export function readJobInspectionContext(jobId: string, scope = getAccountScope()): JobInspectionContext | null {
  requireScope(scope);
  const read = readShopJob(jobId, scope);
  if (!read.ok) throw new Error(read.message);
  requireScope(scope);
  if (!read.value) return null;
  const saved = readLookups();
  requireScope(scope);
  if (!saved.ok) throw new Error(saved.message);
  if (saved.value.some((scan) => !validId(scan.id)) || new Set(saved.value.map((scan) => scan.id)).size !== saved.value.length) {
    throw new Error("Saved scan references could not be read safely. Existing records were preserved.");
  }
  const job = read.value, byId = new Map(saved.value.map((scan) => [scan.id, scan]));
  const ids = unique([...job.scanIds, ...saved.value.filter((scan) => scan.jobId === job.id).map((scan) => scan.id)]);
  const context: JobInspectionContext = { job, scans: [], unavailableScanIds: [], conflictingScanIds: [] };
  for (const id of ids) {
    const scan = byId.get(id);
    if (!scan) context.unavailableScanIds.push(id);
    else if (scan.jobId && scan.jobId !== job.id) context.conflictingScanIds.push(id);
    else context.scans.push(scan);
  }
  requireScope(scope);
  issued.set(context, { scope: { ...scope }, signature: jobInspectionContextSignature(context) });
  return context;
}

/** Ephemeral comparison only: never export this signature. Photo bytes belong to the report collector's verification. */
export function jobInspectionContextSignature(context: JobInspectionContext): string {
  const job = context.job;
  return JSON.stringify({ job: { id: job.id, orgId: job.orgId, createdAt: job.createdAt, updatedAt: job.updatedAt,
    createdByUserId: job.createdByUserId, title: job.title, status: job.status, reviewStatus: job.reviewStatus,
    vehicleContext: normalizeVehicleContext(job) ?? null, scanIds: unique(job.scanIds) },
    scans: [...context.scans].sort((a, b) => a.id.localeCompare(b.id)).map((scan) => ({ id: scan.id, jobId: scan.jobId ?? null,
      createdAt: scan.createdAt, vehicleContext: providerVehicleContext(scan.vehicleContext) ?? null,
      originals: scan.photos === undefined
        ? { legacyFrame: true, capturedAt: scan.frame.capturedAt, present: Boolean(scan.frame.imageBase64) }
        : scan.photos.map((photo) => ({ id: photo.id, label: photo.label, capturedAt: photo.capturedAt, present: Boolean(photo.imageBase64) })) })),
    unavailableScanIds: unique(context.unavailableScanIds), conflictingScanIds: unique(context.conflictingScanIds) });
}

export function assertJobInspectionContextCurrent(context: JobInspectionContext, scope = getAccountScope()): void {
  requireScope(scope);
  const original = issued.get(context);
  if (!original || !isAccountScopeCurrent(original.scope) || original.scope.userId !== scope.userId || original.scope.generation !== scope.generation
    || original.signature !== jobInspectionContextSignature(context)) throw new Error(changed);
  const fresh = readJobInspectionContext(context.job.id, scope);
  if (!fresh || original.signature !== jobInspectionContextSignature(fresh)) throw new Error(changed);
}

const canonicalFact = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
function suppliedFact(value: unknown) {
  const result = canonicalFact(value);
  return /^(?:unknown|not known|unsure|not sure|n\/?a|not provided|not supplied)$/.test(result) ? "" : result;
}

/** Partition the one frozen collector snapshot; never fetch a second report. */
export function buildJobInspectionReportScope(context: JobInspectionContext, snapshot: InspectionReportSnapshot): JobInspectionReportScope {
  const eligible = new Set(context.scans.map((scan) => scan.id));
  if (!eligible.has(snapshot.rootLookupId) || !snapshot.scans.some((scan) => scan.id === snapshot.rootLookupId)) throw new Error("Choose an available scan from this job as the inspection overview.");
  const collected = new Set(snapshot.scans.map((scan) => scan.id));
  const members = new Set([...context.job.scanIds, ...eligible, ...context.unavailableScanIds, ...context.conflictingScanIds]);
  const unavailable = new Set(context.unavailableScanIds), conflicts = new Set(context.conflictingScanIds);
  // A linked source may have been recovered by the collector from cloud storage.
  // Describe that actual snapshot, while still requiring a device-eligible root.
  for (const scan of snapshot.scans) {
    if (scan.jobId === context.job.id) {
      members.add(scan.id);
      if (!conflicts.has(scan.id)) eligible.add(scan.id);
    }
    if (!members.has(scan.id)) continue;
    if (scan.jobId && scan.jobId !== context.job.id) { eligible.delete(scan.id); conflicts.add(scan.id); }
    else if (unavailable.has(scan.id) && !conflicts.has(scan.id)) eligible.add(scan.id);
    unavailable.delete(scan.id);
  }
  const scope: JobInspectionReportScope = { version: 1, jobId: context.job.id, rootLookupId: snapshot.rootLookupId, jobScanIds: unique([...members]),
    includedJobScanIds: unique([...eligible].filter((id) => collected.has(id))), excludedJobScanIds: unique([...eligible].filter((id) => !collected.has(id))),
    unavailableJobScanIds: unique([...unavailable]), conflictingJobScanIds: unique([...conflicts]),
    outsideJobScanIds: unique([...collected].filter((id) => !members.has(id))),
    vehicleDifferences: snapshot.scans.flatMap((scan) => {
      const differences = fields.filter((field) => { const a = suppliedFact(context.job[field]), b = suppliedFact(scan.vehicleContext?.[field]); return Boolean(a && b && a !== b); });
      return differences.length ? [{ lookupId: scan.id, fields: [...differences] }] : [];
    }).sort((a, b) => a.lookupId.localeCompare(b.lookupId)) };
  const checked = normalizeJobInspectionReportScope(scope, snapshot);
  if (!checked) throw new Error("The prepared job handoff scope is inconsistent. Refresh the inspection before downloading.");
  return checked;
}

/** Pure export boundary: reject private/unknown fields and inconsistent coverage, without consulting live device data. */
export function normalizeJobInspectionReportScope(value: unknown, snapshot: Pick<InspectionReportSnapshot, "rootLookupId" | "scans">): JobInspectionReportScope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const listKeys = ["jobScanIds", "includedJobScanIds", "excludedJobScanIds", "unavailableJobScanIds", "outsideJobScanIds", "conflictingJobScanIds"] as const;
  if (Object.keys(raw).some((key) => !["version", "jobId", "rootLookupId", "vehicleDifferences", ...listKeys].includes(key))
    || raw.version !== 1 || !validId(raw.jobId) || raw.rootLookupId !== snapshot.rootLookupId || !validId(raw.rootLookupId)
    || listKeys.some((key) => !Array.isArray(raw[key]) || !(raw[key] as unknown[]).every(validId) || new Set(raw[key] as string[]).size !== (raw[key] as string[]).length)
    || !Array.isArray(raw.vehicleDifferences) || snapshot.scans.some((scan) => !validId(scan.id))) return undefined;
  const lists = Object.fromEntries(listKeys.map((key) => [key, unique(raw[key] as string[])])) as Pick<JobInspectionReportScope, typeof listKeys[number]>;
  const members = new Set(lists.jobScanIds), collected = new Set(snapshot.scans.map((scan) => scan.id));
  if (collected.size !== snapshot.scans.length) return undefined;
  const partition = [...lists.includedJobScanIds, ...lists.excludedJobScanIds, ...lists.unavailableJobScanIds, ...lists.conflictingJobScanIds];
  if (partition.length !== members.size || new Set(partition).size !== partition.length || partition.some((id) => !members.has(id))
    || !lists.includedJobScanIds.includes(raw.rootLookupId) || lists.includedJobScanIds.some((id) => !collected.has(id))
    || lists.excludedJobScanIds.some((id) => collected.has(id)) || lists.unavailableJobScanIds.some((id) => collected.has(id))
    || JSON.stringify(lists.outsideJobScanIds) !== JSON.stringify(unique([...collected].filter((id) => !members.has(id))))) return undefined;
  if (snapshot.scans.some((scan) => scan.jobId === raw.jobId && !members.has(scan.id)
    || members.has(scan.id) && Boolean(scan.jobId) && scan.jobId !== raw.jobId && !lists.conflictingJobScanIds.includes(scan.id))) return undefined;
  const vehicleDifferences: JobInspectionReportScope["vehicleDifferences"] = [];
  for (const entry of raw.vehicleDifferences) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const diff = entry as Record<string, unknown>;
    if (Object.keys(diff).some((key) => key !== "lookupId" && key !== "fields") || !validId(diff.lookupId) || !collected.has(diff.lookupId)
      || vehicleDifferences.some((prior) => prior.lookupId === diff.lookupId) || !Array.isArray(diff.fields) || !diff.fields.length
      || !diff.fields.every((field) => typeof field === "string" && fields.includes(field as typeof fields[number])) || new Set(diff.fields).size !== diff.fields.length) return undefined;
    const selectedFields = diff.fields as string[];
    vehicleDifferences.push({ lookupId: diff.lookupId, fields: fields.filter((field) => selectedFields.includes(field)) });
  }
  return { version: 1, jobId: raw.jobId, rootLookupId: raw.rootLookupId, ...lists, vehicleDifferences: vehicleDifferences.sort((a, b) => a.lookupId.localeCompare(b.lookupId)) };
}
