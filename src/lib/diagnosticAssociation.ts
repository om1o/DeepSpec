import type { DiagnosticAssociation, DiagnosticBundle } from "../types/diagnosticReport";
import { normalizeDiagnosticDocument } from "./diagnosticReport";
import { normalizeComparisonSide, normalizeComparisonTimestamp } from "./inspectionComparison";

export const MAX_DIAGNOSTIC_DOCUMENTS = 8;
export const MAX_DIAGNOSTIC_ASSOCIATIONS = 100;
export const MAX_DIAGNOSTIC_BUNDLE_BYTES = 24 * 1024 * 1024;
export type DiagnosticAssociationStatus = "current" | "superseded" | "conflicting_correction";
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown, max: number, required = false): v is string => typeof v === "string" && v.length <= max && (!required || Boolean(v.trim()));
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const lookup = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(v) && v !== "." && v !== "..";
const entryId = (v: unknown): v is string => typeof v === "string" && /^(controller|fault|frame|reading)-[1-9][0-9]{0,4}$/.test(v);
function fits(v: unknown): boolean {
  try { const raw = JSON.stringify(v); return typeof raw === "string" && raw.length <= MAX_DIAGNOSTIC_BUNDLE_BYTES && new TextEncoder().encode(raw).byteLength <= MAX_DIAGNOSTIC_BUNDLE_BYTES; }
  catch { return false; }
}

export function normalizeDiagnosticAssociation(value: unknown): DiagnosticAssociation | null {
  if (!object(value) || value.version !== 1 || !uuid(value.id) || !lookup(value.lookupId) || !uuid(value.documentId)
    || !text(value.sourceSha256, 64) || !/^[a-f0-9]{64}$/i.test(value.sourceSha256)
    || typeof value.recordedAt !== "string" || !normalizeComparisonTimestamp(value.recordedAt)
    || !text(value.subject, 200, true) || !Array.isArray(value.entryIds) || value.entryIds.length > 100
    || !value.entryIds.every(entryId) || new Set(value.entryIds).size !== value.entryIds.length
    || !Array.isArray(value.photos) || value.photos.length < 1 || value.photos.length > 4
    || typeof value.vehicleRelationship !== "string" || !["unconfirmed", "same_vehicle", "different_vehicle"].includes(value.vehicleRelationship)
    || !text(value.basis, 1000, value.vehicleRelationship !== "unconfirmed") || !text(value.notes, 4000)
    || (value.supersedesId !== undefined && (!uuid(value.supersedesId) || value.supersedesId.toLowerCase() === value.id.toLowerCase()))
    || (value.supersedesId === undefined ? value.correctionReason !== undefined : !text(value.correctionReason, 1000, true))) return null;
  const photos = value.photos.map(normalizeComparisonSide);
  if (photos.some((photo) => !photo || photo.lookupId !== value.lookupId) || new Set(photos.map((photo) => photo?.photoId)).size !== photos.length) return null;
  return { version: 1, id: value.id.toLowerCase(), lookupId: value.lookupId, documentId: value.documentId.toLowerCase(), sourceSha256: value.sourceSha256.toLowerCase(),
    recordedAt: value.recordedAt, subject: value.subject, entryIds: [...value.entryIds], photos: photos as DiagnosticAssociation["photos"],
    vehicleRelationship: value.vehicleRelationship as DiagnosticAssociation["vehicleRelationship"], basis: value.basis, notes: value.notes,
    ...(value.supersedesId === undefined ? {} : { supersedesId: value.supersedesId.toLowerCase(), correctionReason: value.correctionReason as string }) };
}

export function diagnosticAssociationValidationError(value: unknown): string | null {
  return normalizeDiagnosticAssociation(value) ? null : "Choose a saved report and 1–4 checked photos from this scan, enter a subject (up to 200 characters), and explain any same/different vehicle confirmation (up to 1,000 characters). Keep notes within 4,000 characters and provide a correction reason when correcting history.";
}

function entries(value: unknown, lookupId: string): DiagnosticBundle | null {
  if (!lookup(lookupId) || !object(value) || !fits(value) || !Array.isArray(value.documents) || value.documents.length > MAX_DIAGNOSTIC_DOCUMENTS
    || !Array.isArray(value.associations) || value.associations.length > MAX_DIAGNOSTIC_ASSOCIATIONS) return null;
  const documents = value.documents.map((doc) => normalizeDiagnosticDocument(doc, lookupId));
  const associations = value.associations.map(normalizeDiagnosticAssociation);
  if (documents.some((doc) => !doc) || associations.some((record) => !record || record.lookupId !== lookupId)) return null;
  const ids = [...documents.map((doc) => doc!.id), ...associations.map((record) => record!.id)];
  if (new Set(ids).size !== ids.length) return null;
  return { documents: documents as DiagnosticBundle["documents"], associations: associations as DiagnosticBundle["associations"] };
}

function integrity(bundle: DiagnosticBundle): boolean {
  const docs = new Map(bundle.documents.map((doc) => [doc.id, doc]));
  const records = new Map(bundle.associations.map((record) => [record.id, record]));
  return bundle.associations.every((record) => {
    if (docs.get(record.documentId)?.sha256 !== record.sourceSha256) return false;
    const seen = new Set([record.id]); let priorId = record.supersedesId;
    while (priorId) { if (seen.has(priorId)) return false; seen.add(priorId); const prior = records.get(priorId); if (!prior) return false; priorId = prior.supersedesId; }
    return true;
  });
}
const order = (timeA: string, idA: string, timeB: string, idB: string) => Date.parse(timeA) - Date.parse(timeB) || (idA < idB ? -1 : idA > idB ? 1 : 0);
function sorted(bundle: DiagnosticBundle): DiagnosticBundle {
  bundle.documents.sort((a,b) => order(a.importedAt,a.id,b.importedAt,b.id));
  bundle.associations.sort((a,b) => order(a.recordedAt,a.id,b.recordedAt,b.id));
  return bundle;
}
/** Synchronous shape/reference validation. Exact source parsing belongs to verifyDiagnosticBundle. */
export function normalizeDiagnosticBundle(value: unknown, lookupId: string): DiagnosticBundle | null {
  const bundle = entries(value, lookupId); return bundle && integrity(bundle) ? sorted(bundle) : null;
}

/** Inputs may be partial additions; the complete union must retain all references. */
export function mergeDiagnosticBundles(current: DiagnosticBundle, incoming: DiagnosticBundle, lookupId: string): DiagnosticBundle {
  const a = entries(current, lookupId), b = entries(incoming, lookupId);
  if (!a || !b) throw new Error("Diagnostic history is invalid, too large or belongs to a different scan. Existing originals were preserved.");
  const all = new Map<string, { kind: "document" | "association"; value: DiagnosticBundle["documents"][number] | DiagnosticAssociation }>();
  for (const bundle of [a,b]) for (const kind of ["document", "association"] as const) for (const value of kind === "document" ? bundle.documents : bundle.associations) {
    const prior = all.get(value.id);
    if (prior && (prior.kind !== kind || JSON.stringify(prior.value) !== JSON.stringify(value))) throw new Error("A diagnostic ID has conflicting content. Neither immutable version was overwritten.");
    all.set(value.id, { kind, value });
  }
  const union = { documents: [...all.values()].filter((v) => v.kind === "document").map((v) => v.value), associations: [...all.values()].filter((v) => v.kind === "association").map((v) => v.value) };
  const checked = normalizeDiagnosticBundle(union, lookupId);
  if (!checked) throw new Error("Diagnostic history exceeds its limits or has missing document/correction references, a mismatched source hash or a correction cycle. Existing originals were preserved.");
  return checked;
}

export function diagnosticAssociationStatus(record: DiagnosticAssociation, records: readonly DiagnosticAssociation[]): DiagnosticAssociationStatus {
  const same = records.filter((entry) => entry.lookupId === record.lookupId), byId = new Map(same.map((entry) => [entry.id, entry]));
  const seen = new Set<string>(); let current: DiagnosticAssociation | undefined = record;
  while (current) { if (seen.has(current.id) || same.filter((entry) => entry.supersedesId === current!.id).length > 1) return "conflicting_correction"; seen.add(current.id); current = current.supersedesId ? byId.get(current.supersedesId) : undefined; }
  return same.some((entry) => entry.supersedesId === record.id) ? "superseded" : "current";
}
