import type { VehicleContext } from "../types";
import type { ServiceRecord, ServiceRecordCommon } from "../types/serviceRecord";
import { normalizeVehicleContext, vehicleContextDetails } from "./vehicleContext";
import { normalizeRequestedMeasurementReceipt } from "./requestedMeasurement";

export const MAX_SERVICE_RECORDS = 100;
export const MAX_SERVICE_RECORD_BYTES = 256 * 1024;
export type ServiceRecordStatus = "current" | "superseded" | "retracted" | "conflicting_correction";
export type ServiceRecordDisplayOptions = { includeRecorder?: boolean; includeVin?: boolean; includePrivateNotes?: boolean };

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const LOOKUP_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const PHOTO_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max: number, required = false): value is string => typeof value === "string" && value.length <= max && (!required || Boolean(value.trim()));
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const lookupIdValid = (value: unknown): value is string => typeof value === "string" && LOOKUP_ID.test(value) && value !== "." && value !== "..";
const dateValid = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const timestampValid = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

function payloadFits(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" && serialized.length <= MAX_SERVICE_RECORD_BYTES
      && new TextEncoder().encode(serialized).byteLength <= MAX_SERVICE_RECORD_BYTES;
  } catch { return false; }
}

/** Keep only vehicle facts; shop identities and private context notes never enter this log. */
function vehicleSnapshot(value: unknown): VehicleContext | undefined {
  if (!object(value)) return undefined;
  const normalized = normalizeVehicleContext({
    vin: value.vin, year: value.year, make: value.make, model: value.model, engine: value.engine,
    mileage: value.mileage, mileageUnit: value.mileageUnit, modifications: value.modifications,
    confirmedFields: value.confirmedFields, symptom: value.symptom,
  });
  if (!normalized) return undefined;
  const result: VehicleContext = {};
  for (const key of ["vin", "year", "make", "model", "engine", "mileage", "symptom"] as const) if (normalized[key] !== undefined) result[key] = normalized[key];
  if (normalized.mileageUnit !== undefined) result.mileageUnit = normalized.mileageUnit;
  if (normalized.modifications !== undefined) result.modifications = normalized.modifications;
  if (normalized.confirmedFields !== undefined) result.confirmedFields = normalized.confirmedFields;
  return result;
}

function vehicleFieldsValid(value: Record<string, unknown>): boolean {
  for (const field of ["vin", "year", "make", "model", "engine", "mileage", "symptom"] as const) {
    if (value[field] !== undefined && !text(value[field], field === "symptom" ? 500 : 120)) return false;
  }
  if (value.mileageUnit !== undefined && (typeof value.mileageUnit !== "string" || !["mi", "km", "unknown"].includes(value.mileageUnit))) return false;
  if (value.confirmedFields !== undefined && !object(value.confirmedFields)) return false;
  if (value.modifications !== undefined) {
    if (!object(value.modifications) || typeof value.modifications.status !== "string" || !["unknown", "none_known", "modified"].includes(value.modifications.status)) return false;
    if (value.modifications.details !== undefined && !text(value.modifications.details, 600)) return false;
    if (value.modifications.status !== "modified" && value.modifications.details !== undefined && value.modifications.details !== "") return false;
  }
  return true;
}

type ParsedRecord = { ok: true; value: ServiceRecord } | { ok: false; message: string };
const invalid = (message: string): ParsedRecord => ({ ok: false, message });

function parseRecord(value: unknown): ParsedRecord {
  if (!object(value) || (value.version !== 1 && value.version !== 2)) return invalid("This service record has an unsupported version or structure.");
  if (value.version === 1 && "requestedMeasurement" in value) return invalid("A legacy service record cannot contain requested-measurement evidence.");
  if (!uuid(value.id) || !lookupIdValid(value.lookupId)) return invalid("This service record needs a valid entry ID and saved scan ID.");
  if (!timestampValid(value.recordedAt)) return invalid("Recorded time must be a valid UTC ISO timestamp.");
  if (value.occurredOn !== null && !dateValid(value.occurredOn)) return invalid("Enter a valid performed date (YYYY-MM-DD), or leave it unknown.");
  if (!text(value.recordedBy, 120, true)) return invalid("Enter who recorded this information, using 1 to 120 characters.");
  if (typeof value.basis !== "string" || !["personally_performed", "reported_by_another", "transcribed_document"].includes(value.basis)) return invalid("Choose how this human record was obtained.");
  if (!text(value.subject, 200, true)) return invalid("Enter the part or location, using 1 to 200 characters.");
  if (!text(value.notes, 2000)) return invalid("Evidence notes must be text of no more than 2000 characters.");
  if (!Array.isArray(value.photoIds) || value.photoIds.length > 4
    || !value.photoIds.every((id) => typeof id === "string" && PHOTO_ID.test(id) && id !== "." && id !== "..")
    || new Set(value.photoIds).size !== value.photoIds.length) return invalid("Choose up to four distinct saved photo references.");
  if (value.analysisAttemptId !== undefined && !lookupIdValid(value.analysisAttemptId)) return invalid("The saved analysis reference must be a valid opaque ID of no more than 160 characters.");
  if (value.supersedesId !== undefined && (!uuid(value.supersedesId) || value.supersedesId.toLowerCase() === value.id.toLowerCase())) return invalid("A correction must reference a different valid service entry.");
  if (value.supersedesId !== undefined ? !text(value.correctionReason, 1000, true) : value.correctionReason !== undefined) return invalid("A correction needs its prior entry and a reason of 1 to 1000 characters.");
  if (value.vehicleContext !== undefined && (!object(value.vehicleContext) || !vehicleFieldsValid(value.vehicleContext))) return invalid("The saved vehicle context is invalid or exceeds its field limits.");
  const requestedMeasurement = value.version === 2 ? normalizeRequestedMeasurementReceipt(value.requestedMeasurement, value.lookupId) : undefined;
  if (value.version === 2 && (!requestedMeasurement || !["measurement", "retraction"].includes(String(value.kind))
    || requestedMeasurement.guide.analysisAttemptId !== value.analysisAttemptId
    || requestedMeasurement.guide.photoIds.some((photoId) => !(value.photoIds as string[]).includes(photoId)))) return invalid("Keep the exact requested measurement, saved analysis and all cited original references. Only measurements and their retractions can carry this receipt.");
  const metadata = requestedMeasurement ? { version: 2 as const, requestedMeasurement } : { version: 1 as const };
  const vehicleContext = vehicleSnapshot(value.vehicleContext);
  const common: ServiceRecordCommon = {
    id: value.id.toLowerCase(), lookupId: value.lookupId, recordedAt: value.recordedAt,
    occurredOn: value.occurredOn, recordedBy: value.recordedBy, basis: value.basis as ServiceRecordCommon["basis"],
    subject: value.subject, photoIds: [...value.photoIds] as string[], notes: value.notes,
    ...(value.analysisAttemptId === undefined ? {} : { analysisAttemptId: value.analysisAttemptId }),
    ...(vehicleContext ? { vehicleContext } : {}),
    ...(value.supersedesId === undefined ? {} : { supersedesId: value.supersedesId.toLowerCase(), correctionReason: value.correctionReason as string }),
  };
  if (value.kind === "measurement") {
    if (!text(value.quantity, 120, true)) return invalid("Enter the measured quantity, using 1 to 120 characters.");
    if (value.reading !== null && (!text(value.reading, 100, true) || !NUMBER.test(value.reading.trim()) || !Number.isFinite(Number(value.reading)))) return invalid("Enter a finite numeric reading, or choose no reading obtained. The original decimal precision will be retained.");
    if (!text(value.unit, 40, value.reading !== null)) return invalid("A reading needs its unit, using no more than 40 characters.");
    if (!text(value.method, 1000, value.reading !== null)) return invalid("Describe the measurement method (or explicitly say it is unknown), using no more than 1000 characters.");
    if (!text(value.instrument, 200) || !text(value.conditions, 1000)) return invalid("Keep instrument details within 200 characters and measurement conditions within 1000 characters.");
    if (!text(value.noReadingReason, 1000, value.reading === null) || (value.reading !== null && value.noReadingReason !== "")) return invalid("Explain why no reading was obtained, or clear that explanation when recording a reading.");
    return { ok: true, value: { ...common, ...metadata, kind: "measurement", quantity: value.quantity, reading: value.reading, unit: value.unit, method: value.method, instrument: value.instrument, conditions: value.conditions, noReadingReason: value.noReadingReason } };
  }
  if (value.kind === "repair") {
    if (!text(value.action, 2000, true) || !text(value.parts, 2000)) return invalid("Describe the repair work and parts using no more than 2000 characters each.");
    if (typeof value.status !== "string" || !["planned", "completed", "attempted", "unknown"].includes(value.status)) return invalid("Choose the reported repair status.");
    return { ok: true, value: { ...common, version: 1, kind: "repair", action: value.action, status: value.status as "planned" | "completed" | "attempted" | "unknown", parts: value.parts } };
  }
  if (value.kind === "follow_up") {
    if (typeof value.outcome !== "string" || !["not_checked", "symptom_observed", "symptom_not_observed", "inconclusive"].includes(value.outcome)) return invalid("Choose the follow-up outcome.");
    if (!text(value.check, 2000, value.outcome !== "not_checked") || !text(value.conditions, 1000)) return invalid("Describe the follow-up check (up to 2000 characters) and its conditions (up to 1000 characters).");
    if (!Array.isArray(value.relatedRecordIds) || value.relatedRecordIds.length > MAX_SERVICE_RECORDS || !value.relatedRecordIds.every(uuid)) return invalid("Follow-up references must identify saved service entries.");
    const relatedRecordIds = value.relatedRecordIds.map((id) => id.toLowerCase());
    if (new Set(relatedRecordIds).size !== relatedRecordIds.length || relatedRecordIds.includes(common.id)) return invalid("Follow-up references must be distinct and cannot reference the follow-up itself.");
    return { ok: true, value: { ...common, version: 1, kind: "follow_up", check: value.check, outcome: value.outcome as "not_checked" | "symptom_observed" | "symptom_not_observed" | "inconclusive", conditions: value.conditions, relatedRecordIds } };
  }
  if (value.kind === "retraction") {
    if (!common.supersedesId || !common.correctionReason) return invalid("A retraction must identify its prior entry and explain why it is retracted.");
    return { ok: true, value: { ...common, ...metadata, kind: "retraction", supersedesId: common.supersedesId, correctionReason: common.correctionReason } };
  }
  return invalid("Choose measurement, repair, follow-up or retraction.");
}

export function serviceRecordValidationError(value: unknown): string | null {
  if (!payloadFits(value)) return "This service record is too large or cannot be serialized safely.";
  const parsed = parseRecord(value);
  return parsed.ok ? null : parsed.message;
}

/** Validates one entry's shape; graph and scan membership checks require the complete history. */
export function normalizeServiceRecord(value: unknown): ServiceRecord | undefined {
  if (!payloadFits(value)) return undefined;
  const parsed = parseRecord(value);
  return parsed.ok ? parsed.value : undefined;
}

function normalizeEntries(value: unknown, lookupId: string): ServiceRecord[] | undefined {
  if (!lookupIdValid(lookupId) || !Array.isArray(value) || value.length > MAX_SERVICE_RECORDS || !payloadFits(value)) return undefined;
  const result: ServiceRecord[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const parsed = parseRecord(raw);
    if (!parsed.ok || parsed.value.lookupId !== lookupId || ids.has(parsed.value.id)) return undefined;
    ids.add(parsed.value.id); result.push(parsed.value);
  }
  return result;
}

function references(record: ServiceRecord): string[] {
  return [...(record.supersedesId ? [record.supersedesId] : []), ...(record.kind === "follow_up" ? record.relatedRecordIds : [])];
}

function graphValid(records: readonly ServiceRecord[]): boolean {
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    if (references(record).some((id) => !byId.has(id))) return false;
    if (record.supersedesId) {
      const previous = byId.get(record.supersedesId)!;
      if (previous.kind === "retraction" || (record.kind !== "retraction" && record.kind !== previous.kind)) return false;
      if (record.version !== previous.version || (previous.version === 2 && (record.version !== 2
        || JSON.stringify(previous.requestedMeasurement) !== JSON.stringify(record.requestedMeasurement)))) return false;
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (record: ServiceRecord): boolean => {
    if (visiting.has(record.id)) return false;
    if (visited.has(record.id)) return true;
    visiting.add(record.id);
    for (const id of references(record)) if (!visit(byId.get(id)!)) return false;
    visiting.delete(record.id); visited.add(record.id); return true;
  };
  return records.every(visit);
}

const stableOrder = (left: ServiceRecord, right: ServiceRecord): number => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
  || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export function normalizeServiceRecords(value: unknown, lookupId: string): ServiceRecord[] | undefined {
  const records = normalizeEntries(value, lookupId);
  return records && graphValid(records) ? records.sort(stableOrder) : undefined;
}

/** Union immutable entries; a same-ID write may retry only the same canonical content. */
export function mergeServiceRecords(local: readonly ServiceRecord[], incoming: readonly ServiceRecord[], lookupId: string): ServiceRecord[] {
  const left = normalizeEntries(local, lookupId), right = normalizeEntries(incoming, lookupId);
  if (!left || !right) throw new Error("Service history is invalid, exceeds its limit, or belongs to a different saved scan.");
  const byId = new Map(left.map((record) => [record.id, record]));
  for (const record of right) {
    const previous = byId.get(record.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error("A service entry ID has conflicting content. Both versions must be preserved for review; neither was overwritten.");
    byId.set(record.id, record);
  }
  const result = [...byId.values()];
  if (result.length > MAX_SERVICE_RECORDS || !payloadFits(result)) throw new Error("Service history exceeds 100 entries or 256 KiB. Existing records were not truncated.");
  if (!graphValid(result)) throw new Error("Service history has missing references, incompatible corrections or a reference cycle.");
  return result.sort(stableOrder);
}

/** Forks remain unresolved even if device clocks suggest one correction is newer. */
export function serviceRecordStatus(record: ServiceRecord, all: readonly ServiceRecord[]): ServiceRecordStatus {
  const sameScan = all.filter((entry) => entry.lookupId === record.lookupId);
  const byId = new Map(sameScan.map((entry) => [entry.id, entry]));
  const children = new Map<string, ServiceRecord[]>();
  for (const entry of sameScan) if (entry.supersedesId) children.set(entry.supersedesId, [...(children.get(entry.supersedesId) ?? []), entry]);
  const seen = new Set<string>();
  let ancestor: ServiceRecord | undefined = record;
  while (ancestor) {
    if (seen.has(ancestor.id) || (children.get(ancestor.id)?.length ?? 0) > 1) return "conflicting_correction";
    seen.add(ancestor.id); ancestor = ancestor.supersedesId ? byId.get(ancestor.supersedesId) : undefined;
  }
  const next = children.get(record.id)?.[0];
  if (record.kind === "retraction" || next?.kind === "retraction") return "retracted";
  return next ? "superseded" : "current";
}

/** Plain-text field projection shared by UI and report; consumers must escape HTML. */
export function serviceRecordRows(record: ServiceRecord, options: ServiceRecordDisplayOptions = {}): [string, string][] {
  const basis = { personally_performed: "Personally performed — self-reported", reported_by_another: "Reported by another person — not independently verified", transcribed_document: "Transcribed from a document — document not independently verified" };
  const rows: [string, string][] = [
    ["Record type", { measurement: "Human-recorded measurement", repair: "Human-reported repair", follow_up: "Human-recorded follow-up", retraction: "Retraction of a human record" }[record.kind]],
    ["Subject / location", record.subject], ["Recorded", record.recordedAt], ["Performed date", record.occurredOn ?? "Unknown"], ["Source", basis[record.basis]],
    ["Photo references", record.photoIds.length ? record.photoIds.join(", ") : "No photos linked"],
  ];
  if (options.includeRecorder) rows.push(["Recorded by — self-reported", record.recordedBy]);
  if (record.analysisAttemptId) rows.push(["Saved analysis reference", record.analysisAttemptId]);
  if (record.version === 2) {
    const receipt = record.requestedMeasurement;
    rows.push(["Historical measurement request", receipt.guide.request], ["Request purpose", receipt.guide.purpose],
      ["Request analysis SHA-256", receipt.analysisSha256],
      ["Request cited originals", receipt.guide.photoIds.length ? receipt.guide.photoIds.join(", ") : "No originals cited; no original image is bound to this request"],
      ["Request association limits", "A human response to a historical request does not establish that it is resolved, confirm a diagnosis or certify safety."]);
    for (const reference of receipt.references) rows.push([`Request original — ${reference.photoId}`,
      `${reference.photoLabel}; ${reference.width} × ${reference.height}; SHA-256 ${reference.sha256}; added ${reference.photoAddedAt}; scan saved ${reference.scanSavedAt}`]);
  }
  if (record.supersedesId) rows.push(["Supersedes entry", record.supersedesId], ["Correction / retraction reason", record.correctionReason!]);
  if (record.vehicleContext) {
    const safe = vehicleSnapshot(record.vehicleContext);
    if (safe) for (const [label, value] of vehicleContextDetails({ ...safe, ...(options.includeVin ? {} : { vin: undefined }) })) {
      if (label !== "VIN" || options.includeVin) rows.push([`Saved vehicle — ${label}`, value]);
    }
  } else rows.push(["Saved vehicle context", "Not recorded"]);
  if (record.kind === "measurement") rows.push(
    ["Quantity", record.quantity], ["Human-recorded reading", record.reading === null ? "No reading obtained" : `${record.reading} ${record.unit}`],
    ["Method", record.method || "Not recorded"], ["Instrument", record.instrument || "Not recorded"], ["Conditions", record.conditions || "Not recorded"],
    ...(record.reading === null ? [["Reason no reading was obtained", record.noReadingReason] as [string, string]] : []),
    ["Measurement limits", "Human-entered evidence, not an AI estimate or independently verified measurement. Instrument accuracy, calibration, traceability and fitness for purpose are not established by this entry."],
  );
  if (record.kind === "repair") rows.push(
    ["Reported work", record.action], ["Reported repair status", { planned: "Planned — not recorded as performed", completed: "Completed — self-reported; outcome not established", attempted: "Attempted — completion not established", unknown: "Unknown" }[record.status]],
    ["Parts", record.parts || "Not recorded"], ["Repair limits", "Reported work does not establish the cause, resolve a symptom, prove function or clear a safety action. Follow-up must be recorded separately."],
  );
  if (record.kind === "follow_up") rows.push(
    [record.outcome === "not_checked" ? "Check intended / not performed" : "Check performed", record.check || "No check recorded"], ["Follow-up outcome", { not_checked: "Not checked", symptom_observed: "Symptom observed during the recorded check", symptom_not_observed: "Symptom not observed during this check — not proof of a permanent resolution", inconclusive: "Inconclusive" }[record.outcome]],
    ["Check conditions", record.conditions || "Not recorded"], ["Related service entries", record.relatedRecordIds.length ? record.relatedRecordIds.join(", ") : "No related entries linked"],
    ["Follow-up limits", "A follow-up result does not certify safety, clear prior safety actions or rewrite the AI findings."],
  );
  if (record.kind === "retraction") rows.push(["Retraction effect", "The earlier statement remains in history and is marked retracted. No replacement finding or safety clearance is inferred."]);
  rows.push(["Evidence notes", record.notes || "None recorded"]);
  return rows;
}
