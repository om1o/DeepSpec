import { SCAN_PHOTO_LABELS, type VehicleContext } from "../types";
import type { ComparisonCaptureTarget, ComparisonSide, InspectionComparison } from "../types/inspectionComparison";
import { providerVehicleContext } from "./vehicleContext";

export const MAX_INSPECTION_COMPARISONS = 100;
export const MAX_INSPECTION_COMPARISON_BYTES = 256 * 1024;
export type InspectionComparisonStatus = "current" | "superseded" | "conflicting_correction";
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max: number, required = false): value is string => typeof value === "string" && value.length <= max && (!required || Boolean(value.trim()));
const id = (value: unknown, max = 160): value is string => typeof value === "string" && value.length <= max && /^[A-Za-z0-9._:-]+$/.test(value) && value !== "." && value !== "..";
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const time = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && !value.startsWith("0000-") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !value.startsWith("0000-") && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const number = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const member = <T extends string>(value: unknown, allowed: readonly T[]): value is T => typeof value === "string" && allowed.includes(value as T);
function fits(value: unknown) {
  try { const raw = JSON.stringify(value); return typeof raw === "string" && raw.length <= MAX_INSPECTION_COMPARISON_BYTES && new TextEncoder().encode(raw).byteLength <= MAX_INSPECTION_COMPARISON_BYTES; }
  catch { return false; }
}

/** Cloud timestamptz values can use an offset or microseconds. Canonicalize new
 * source snapshots without rewriting the serialization of immutable records. */
export function normalizeComparisonTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !date(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return undefined;
  const canonical = new Date(value).toISOString();
  return time(canonical) ? canonical : undefined;
}

function vehicle(value: unknown): VehicleContext | null | undefined {
  if (value === null) return null;
  if (!object(value)) return undefined;
  for (const key of ["vin", "year", "make", "model", "engine", "mileage", "symptom"] as const) if (value[key] !== undefined && !text(value[key], key === "symptom" ? 500 : 120)) return undefined;
  if (value.mileageUnit !== undefined && !member(value.mileageUnit, ["mi", "km", "unknown"])) return undefined;
  if (value.modifications !== undefined) {
    if (!object(value.modifications) || !member(value.modifications.status, ["unknown", "none_known", "modified"]) || (value.modifications.details !== undefined && !text(value.modifications.details, 600))) return undefined;
    if (value.modifications.status !== "modified" && value.modifications.details !== undefined && value.modifications.details !== "") return undefined;
  }
  if (value.confirmedFields !== undefined && !object(value.confirmedFields)) return undefined;
  const safe = providerVehicleContext(value);
  if (safe?.confirmedFields) for (const confirmation of Object.values(safe.confirmedFields)) {
    const canonicalTime = normalizeComparisonTimestamp(confirmation.confirmedAt);
    if (!canonicalTime) return undefined;
    confirmation.confirmedAt = canonicalTime;
  }
  return safe ?? null;
}

export function normalizeComparisonSide(value: unknown): ComparisonSide | undefined {
  if (!object(value) || !fits(value) || !id(value.lookupId) || !id(value.photoId, 80) || !member(value.photoLabel, SCAN_PHOTO_LABELS)
    || !time(value.photoAddedAt) || !time(value.scanSavedAt) || !text(value.sha256, 64) || !/^[a-f0-9]{64}$/i.test(value.sha256)
    || !number(value.width, 1, 32768) || !Number.isInteger(value.width) || !number(value.height, 1, 32768) || !Number.isInteger(value.height) || value.width * value.height > 100_000_000
    || (value.observedOn !== null && !date(value.observedOn)) || (value.analysisAttemptId !== undefined && !id(value.analysisAttemptId))) return undefined;
  const vehicleContext = vehicle(value.vehicleContext);
  if (vehicleContext === undefined) return undefined;
  return { lookupId: value.lookupId, photoId: value.photoId, photoLabel: value.photoLabel, photoAddedAt: value.photoAddedAt, scanSavedAt: value.scanSavedAt,
    sha256: value.sha256.toLowerCase(), width: value.width, height: value.height, observedOn: value.observedOn, vehicleContext,
    ...(value.analysisAttemptId === undefined ? {} : { analysisAttemptId: value.analysisAttemptId }) };
}

/** The human-reported observation date is not a mutable source-photo attribute. */
export function comparisonSideMatches(left: ComparisonSide, right: ComparisonSide): boolean {
  const a = normalizeComparisonSide(left), b = normalizeComparisonSide(right);
  const instant = (side: ComparisonSide) => ({ ...side, photoAddedAt: normalizeComparisonTimestamp(side.photoAddedAt), scanSavedAt: normalizeComparisonTimestamp(side.scanSavedAt), observedOn: null });
  return Boolean(a && b && JSON.stringify(instant(a)) === JSON.stringify(instant(b)));
}

export function normalizeComparisonCaptureTarget(value: unknown): ComparisonCaptureTarget | undefined {
  if (!object(value) || value.version !== 1 || !uuid(value.comparisonId) || !id(value.lookupId) || !text(value.subject, 200, true)) return undefined;
  const earlier = normalizeComparisonSide(value.earlier);
  if (!earlier || earlier.lookupId === value.lookupId) return undefined;
  return { version: 1, comparisonId: value.comparisonId.toLowerCase(), lookupId: value.lookupId, earlier, subject: value.subject };
}

export function normalizeInspectionComparison(value: unknown): InspectionComparison | undefined {
  if (!object(value) || !fits(value) || value.version !== 1 || !uuid(value.id) || !id(value.lookupId) || !time(value.recordedAt) || !text(value.subject, 200, true)) return undefined;
  const earlier = normalizeComparisonSide(value.earlier), current = normalizeComparisonSide(value.current);
  if (!earlier || !current || current.lookupId !== value.lookupId || earlier.lookupId === current.lookupId
    || (earlier.observedOn && current.observedOn && earlier.observedOn > current.observedOn)) return undefined;
  const r = value.relationship, c = value.conditions, o = value.observation, a = value.alignment;
  if (!object(r) || typeof r.sameVehicle !== "boolean" || !member(r.component, ["unconfirmed", "same_part", "replacement_same_location", "different"])
    || !text(r.basis, 1000, r.sameVehicle || r.component !== "unconfirmed") || !object(c) || !member(c.angle, ["similar", "different", "unknown"])
    || !member(c.lighting, ["similar", "different", "unknown"]) || !text(c.surfaceNotes, 2000) || !object(o)
    || !member(o.outcome, ["not_reviewed", "change_observed", "no_obvious_change", "inconclusive"]) || !text(o.notes, 2000, o.outcome !== "not_reviewed")
    || ((o.outcome === "change_observed" || o.outcome === "no_obvious_change") && (!r.sameVehicle || r.component !== "same_part"))
    || !object(a) || !number(a.rotation, -180, 180) || !number(a.scale, .25, 4) || !number(a.offsetX, -1, 1) || !number(a.offsetY, -1, 1)
    || (value.supersedesId !== undefined && (!uuid(value.supersedesId) || value.supersedesId.toLowerCase() === value.id.toLowerCase()))
    || (value.supersedesId === undefined ? value.correctionReason !== undefined : !text(value.correctionReason, 1000, true))) return undefined;
  return { version: 1, id: value.id.toLowerCase(), lookupId: value.lookupId, recordedAt: value.recordedAt, subject: value.subject, earlier, current,
    relationship: { sameVehicle: r.sameVehicle, component: r.component, basis: r.basis }, conditions: { angle: c.angle, lighting: c.lighting, surfaceNotes: c.surfaceNotes },
    observation: { outcome: o.outcome, notes: o.notes }, alignment: { rotation: a.rotation, scale: a.scale, offsetX: a.offsetX, offsetY: a.offsetY },
    ...(value.supersedesId === undefined ? {} : { supersedesId: value.supersedesId.toLowerCase(), correctionReason: value.correctionReason as string }) };
}

export function inspectionComparisonValidationError(value: unknown): string | null {
  return normalizeInspectionComparison(value) ? null : "Review both saved originals, valid dates, subject and comparison details. Change/no-obvious-change requires your same-vehicle and same-part confirmation with its basis; other comparisons must remain unreviewed or inconclusive. Keep notes within 2,000 characters and alignment within its controls.";
}
function entries(value: unknown, lookupId: string): InspectionComparison[] | undefined {
  if (!id(lookupId) || !Array.isArray(value) || value.length > MAX_INSPECTION_COMPARISONS || !fits(value)) return undefined;
  const result: InspectionComparison[] = [], ids = new Set<string>();
  for (const raw of value) {
    const record = normalizeInspectionComparison(raw);
    if (!record || record.lookupId !== lookupId || ids.has(record.id)) return undefined;
    ids.add(record.id); result.push(record);
  }
  return result;
}
function graphValid(records: readonly InspectionComparison[]): boolean {
  const byId = new Map(records.map((record) => [record.id, record]));
  return records.every((record) => {
    const seen = new Set([record.id]); let previous = record.supersedesId;
    while (previous) { if (seen.has(previous)) return false; seen.add(previous); const prior = byId.get(previous); if (!prior) return false; previous = prior.supersedesId; }
    return true;
  });
}
const order = (a: InspectionComparison, b: InspectionComparison) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function normalizeInspectionComparisons(value: unknown, lookupId: string): InspectionComparison[] | undefined {
  const records = entries(value, lookupId); return records && graphValid(records) ? records.sort(order) : undefined;
}
export function mergeInspectionComparisons(left: readonly InspectionComparison[], right: readonly InspectionComparison[], lookupId: string): InspectionComparison[] {
  const a = entries(left, lookupId), b = entries(right, lookupId);
  if (!a || !b) throw new Error("Comparison history is invalid, too large or belongs to a different scan. Existing records were preserved.");
  const byId = new Map(a.map((record) => [record.id, record]));
  for (const record of b) { const prior = byId.get(record.id); if (prior && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error("A comparison ID has conflicting content. Neither immutable version was overwritten."); byId.set(record.id, record); }
  const records = [...byId.values()];
  if (records.length > MAX_INSPECTION_COMPARISONS || !fits(records)) throw new Error("Comparison history exceeds 100 records or 256 KiB. Existing records were not truncated.");
  if (!graphValid(records)) throw new Error("Comparison history has missing correction references or a cycle.");
  return records.sort(order);
}
export function inspectionComparisonStatus(record: InspectionComparison, records: readonly InspectionComparison[]): InspectionComparisonStatus {
  const same = records.filter((entry) => entry.lookupId === record.lookupId), byId = new Map(same.map((entry) => [entry.id, entry]));
  const seen = new Set<string>(); let current: InspectionComparison | undefined = record;
  while (current) { if (seen.has(current.id) || same.filter((entry) => entry.supersedesId === current!.id).length > 1) return "conflicting_correction"; seen.add(current.id); current = current.supersedesId ? byId.get(current.supersedesId) : undefined; }
  return same.some((entry) => entry.supersedesId === record.id) ? "superseded" : "current";
}
