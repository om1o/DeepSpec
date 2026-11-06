import type { ConditionObservation } from "../types";
import type { ObservationAreaBinding, ObservationAreaDraft, ObservationAreaGroup, ObservationAreaRecord, ObservationAreaRectangle, ObservationAreaRecordStatus } from "../types/observationArea";
import { normalizeComparisonSide } from "./inspectionComparison";

export const MAX_OBSERVATION_AREA_RECORDS = 100;
export const MAX_OBSERVATION_AREA_BYTES = 256 * 1024;
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const keys = (v: Record<string, unknown>, allowed: readonly string[]) => Object.keys(v).every((k) => allowed.includes(k));
const text = (v: unknown, max: number, required = false): v is string => typeof v === "string" && v.length <= max && (!required || Boolean(v.trim()));
const id = (v: unknown, max = 160): v is string => typeof v === "string" && v.length <= max && /^[A-Za-z0-9._:-]+$/.test(v) && v !== "." && v !== "..";
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const time = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v)
  && !v.startsWith("0000-") && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
export function observationAreaPayloadFits(value: unknown): boolean {
  try { const raw = JSON.stringify(value); return typeof raw === "string" && raw.length <= MAX_OBSERVATION_AREA_BYTES && new TextEncoder().encode(raw).byteLength <= MAX_OBSERVATION_AREA_BYTES; }
  catch { return false; }
}
export function normalizeObservationAreaRectangle(value: unknown): ObservationAreaRectangle | undefined {
  if (!object(value) || !keys(value, ["x", "y", "width", "height"])) return undefined;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number"
    || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return undefined;
  return { x, y, width, height };
}
function observation(value: unknown): ConditionObservation | undefined {
  if (!object(value) || !keys(value, ["id", "text", "photoIds", "regionLabel", "areas"])
    || !text(value.id, 80, true) || !text(value.text, 600, true) || value.text !== value.text.trim()
    || !Array.isArray(value.photoIds) || !value.photoIds.length || value.photoIds.length > 4 || !Array.from(value.photoIds).every((p) => id(p, 80))
    || new Set(value.photoIds).size !== value.photoIds.length
    || (value.regionLabel !== undefined && (!text(value.regionLabel, 120, true) || value.regionLabel !== value.regionLabel.trim()))) return undefined;
  let areas: { photoId: string; rectangle: ObservationAreaRectangle }[] | undefined;
  if (Object.hasOwn(value, "areas")) {
    if (!Array.isArray(value.areas) || value.areas.length > 4) return undefined;
    areas = [];
    for (const area of value.areas) {
      if (!object(area) || !keys(area, ["photoId", "rectangle"]) || !id(area.photoId, 80) || !value.photoIds.includes(area.photoId)
        || areas.some((a) => a.photoId === area.photoId)) return undefined;
      const rectangle = normalizeObservationAreaRectangle(area.rectangle); if (!rectangle) return undefined;
      areas.push({ photoId: area.photoId, rectangle });
    }
  }
  return { id: value.id, text: value.text, photoIds: [...value.photoIds], ...(value.regionLabel === undefined ? {} : { regionLabel: value.regionLabel }), ...(areas ? { areas } : {}) };
}
export function normalizeObservationAreaBinding(value: unknown, lookupId?: string): ObservationAreaBinding | undefined {
  if (!object(value) || !observationAreaPayloadFits(value) || value.version !== 1
    || !keys(value, ["version", "observation", "analysisSha256", "analysisAttemptId", "reference"])
    || !text(value.analysisSha256, 64) || !/^[a-f0-9]{64}$/.test(value.analysisSha256)
    || (value.analysisAttemptId !== undefined && !id(value.analysisAttemptId)) || (lookupId !== undefined && !id(lookupId))) return undefined;
  if (!object(value.reference) || !keys(value.reference, ["lookupId", "photoId", "photoLabel", "photoAddedAt", "scanSavedAt", "sha256", "width", "height", "observedOn", "vehicleContext", "analysisAttemptId"])) return undefined;
  const claim = observation(value.observation), reference = normalizeComparisonSide(value.reference);
  if (!claim || !reference || !claim.photoIds.includes(reference.photoId) || (lookupId !== undefined && reference.lookupId !== lookupId)
    || reference.analysisAttemptId !== value.analysisAttemptId) return undefined;
  return { version: 1, observation: claim, analysisSha256: value.analysisSha256, ...(value.analysisAttemptId === undefined ? {} : { analysisAttemptId: value.analysisAttemptId }), reference };
}
export function observationAreaBindingKey(value: ObservationAreaBinding): string {
  const binding = normalizeObservationAreaBinding(value);
  if (!binding) throw new Error("The observation/photo binding is invalid. Its saved evidence was preserved.");
  return JSON.stringify(binding);
}
export function normalizeObservationAreaRecord(value: unknown, lookupId?: string): ObservationAreaRecord | undefined {
  if (!object(value) || !observationAreaPayloadFits(value) || value.version !== 1
    || !keys(value, ["version", "id", "lookupId", "recordedAt", "binding", "notes", "kind", "rectangle", "supersedesId", "correctionReason"])
    || !uuid(value.id) || !id(value.lookupId) || (lookupId !== undefined && lookupId !== value.lookupId) || !time(value.recordedAt)
    || !text(value.notes, 1000) || (value.supersedesId !== undefined && (!uuid(value.supersedesId) || value.id.toLowerCase() === value.supersedesId.toLowerCase()))
    || (value.supersedesId === undefined ? value.correctionReason !== undefined : !text(value.correctionReason, 1000, true))) return undefined;
  const binding = normalizeObservationAreaBinding(value.binding, value.lookupId); if (!binding) return undefined;
  const common = { version: 1 as const, id: value.id.toLowerCase(), lookupId: value.lookupId, recordedAt: value.recordedAt, binding, notes: value.notes };
  if (value.kind === "retraction") return !Object.hasOwn(value, "rectangle") && typeof value.supersedesId === "string" && typeof value.correctionReason === "string"
    ? { ...common, kind: "retraction", supersedesId: value.supersedesId.toLowerCase(), correctionReason: value.correctionReason } : undefined;
  const rectangle = normalizeObservationAreaRectangle(value.rectangle);
  return value.kind === "mark" && rectangle ? { ...common, kind: "mark", rectangle,
    ...(value.supersedesId === undefined ? {} : { supersedesId: value.supersedesId.toLowerCase(), correctionReason: value.correctionReason as string }) } : undefined;
}
const order = (a: ObservationAreaRecord, b: ObservationAreaRecord) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function normalizeObservationAreaRecords(value: unknown, lookupId: string): ObservationAreaRecord[] | undefined {
  if (!id(lookupId) || !Array.isArray(value) || value.length > MAX_OBSERVATION_AREA_RECORDS || !observationAreaPayloadFits(value)) return undefined;
  const records: ObservationAreaRecord[] = [], byId = new Map<string, ObservationAreaRecord>();
  for (const raw of value) {
    const record = normalizeObservationAreaRecord(raw, lookupId); if (!record || byId.has(record.id)) return undefined;
    records.push(record); byId.set(record.id, record);
  }
  for (const record of records) {
    const seen = new Set([record.id]); let child = record;
    while (child.supersedesId) {
      const parent = byId.get(child.supersedesId);
      if (!parent || seen.has(parent.id) || observationAreaBindingKey(parent.binding) !== observationAreaBindingKey(child.binding)) return undefined;
      seen.add(parent.id); child = parent;
    }
  }
  return records.sort(order);
}
export function observationAreaGroups(records: readonly ObservationAreaRecord[]): ObservationAreaGroup[] {
  const byKey = new Map<string, ObservationAreaRecord[]>();
  const lookups = new Set(records.map((r) => r.lookupId));
  for (const lookupId of lookups) if (!normalizeObservationAreaRecords(records.filter((r) => r.lookupId === lookupId), lookupId)) throw new Error("Observation area history is invalid or incomplete. It was preserved for recovery.");
  for (const record of records) { const key = observationAreaBindingKey(record.binding); byKey.set(key, [...(byKey.get(key) ?? []), record]); }
  return [...byKey].map(([key, entries]) => {
    const sorted = [...entries].sort(order), parents = new Set(entries.flatMap((r) => r.supersedesId ? [r.supersedesId] : []));
    const heads = sorted.filter((r) => !parents.has(r.id));
    const head = heads.length === 1 ? heads[0] : null;
    const status: ObservationAreaGroup["status"] = !head ? "conflicting" : head.kind === "retraction" ? "retracted" : "current";
    return { key, binding: sorted[0].binding, records: sorted, heads, head, status };
  });
}
export function observationAreaRecordStatus(record: ObservationAreaRecord, records: readonly ObservationAreaRecord[]): ObservationAreaRecordStatus {
  const group = observationAreaGroups(records).find((g) => g.key === observationAreaBindingKey(record.binding));
  if (!group || !group.head) return "conflicting";
  if (group.head.id === record.id) return group.status;
  return records.some((r) => r.supersedesId === record.id && r.kind === "retraction") ? "retracted" : "superseded";
}
export function normalizeObservationAreaDraft(value: unknown, lookupId?: string): ObservationAreaDraft | undefined {
  if (!object(value) || !observationAreaPayloadFits(value) || value.version !== 1
    || !keys(value, ["version", "id", "lookupId", "recordedAt", "updatedAt", "binding", "expectedHeadId", "kind", "rectangle", "notes", "correctionReason"])
    || !uuid(value.id) || !id(value.lookupId) || (lookupId !== undefined && value.lookupId !== lookupId) || !time(value.recordedAt) || !time(value.updatedAt)
    || (value.expectedHeadId !== null && (!uuid(value.expectedHeadId) || value.expectedHeadId.toLowerCase() === value.id.toLowerCase()))
    || !["mark", "retraction"].includes(String(value.kind)) || !text(value.notes, 1000) || !text(value.correctionReason, 1000)
    || (value.expectedHeadId === null && (value.kind !== "mark" || value.correctionReason !== ""))) return undefined;
  const binding = normalizeObservationAreaBinding(value.binding, value.lookupId);
  const rectangle = value.rectangle === null ? null : normalizeObservationAreaRectangle(value.rectangle);
  if (!binding || rectangle === undefined || (value.kind === "retraction" && rectangle !== null)) return undefined;
  return { version: 1, id: value.id.toLowerCase(), lookupId: value.lookupId, recordedAt: value.recordedAt, updatedAt: value.updatedAt, binding,
    expectedHeadId: value.expectedHeadId === null ? null : value.expectedHeadId.toLowerCase(), kind: value.kind as "mark" | "retraction", rectangle, notes: value.notes, correctionReason: value.correctionReason };
}
export function observationAreaRecordFromDraft(draft: ObservationAreaDraft): ObservationAreaRecord | undefined {
  const checked = normalizeObservationAreaDraft(draft); if (!checked) return undefined;
  return normalizeObservationAreaRecord({ version: 1, id: checked.id, lookupId: checked.lookupId, recordedAt: checked.recordedAt, binding: checked.binding, notes: checked.notes, kind: checked.kind,
    ...(checked.kind === "mark" ? { rectangle: checked.rectangle } : {}),
    ...(checked.expectedHeadId === null ? {} : { supersedesId: checked.expectedHeadId, correctionReason: checked.correctionReason }) });
}
