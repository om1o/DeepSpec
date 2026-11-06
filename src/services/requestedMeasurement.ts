import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { buildConditionHandoff } from "../lib/conditionHandoff";
import { normalizeRequestedMeasurementGuide, normalizeRequestedMeasurementReceipt } from "../lib/requestedMeasurement";
import { photoRelationshipOrUnknown } from "../lib/photoRelationship";
import { providerVehicleContext } from "../lib/vehicleContext";
import type { Lookup } from "../types";
import type { RequestedMeasurementGuide, RequestedMeasurementReceipt } from "../types/requestedMeasurement";
import { comparisonSideForLookup, resolveComparisonSide } from "./comparisonEvidence";
import { boundedOriginalEvidenceOperation, originalImageReference } from "./originalImageEvidence";
import { getLookup } from "./storage";

export type VerifiedRequestedMeasurement = {
  readonly lookupId: string;
  readonly receipt: RequestedMeasurementReceipt;
};
const guards = new WeakMap<VerifiedRequestedMeasurement, {
  scope: AccountScope; source: string; receipt: RequestedMeasurementReceipt; canonicalReceipt: string; signal?: AbortSignal;
}>();

function requireScope(scope: AccountScope, signal?: AbortSignal) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen the requested measurement in its original account.");
  if (signal?.aborted) throw new Error("Requested-measurement preparation was canceled. Your saved inspection and human draft were kept.");
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
function analysisSnapshot(lookup: Lookup): string {
  if (!lookup.result) throw new Error("The saved AI result is unavailable. Reopen the inspection before recording its requested measurement.");
  const value = canonical({ result: lookup.result, analysisAttemptId: lookup.analysisAttemptId ?? null });
  if (new TextEncoder().encode(value).byteLength > 256 * 1024) throw new Error("The saved AI result is too large to verify safely. Your saved inspection and draft were kept.");
  return value;
}

/** Use the same validated request shown beside the finding. No reading or unit is inferred. */
export function requestedMeasurementGuideForLookup(lookup: Lookup): RequestedMeasurementGuide | null {
  const next = buildConditionHandoff(lookup).nextEvidence;
  if (!next || next.kind !== "measurement") return null;
  return normalizeRequestedMeasurementGuide({ version: 1, kind: "measurement", request: next.request, purpose: next.purpose,
    photoIds: next.photoIds ?? [], ...(lookup.analysisAttemptId === undefined ? {} : { analysisAttemptId: lookup.analysisAttemptId }) }) ?? null;
}

/** This is a mutation/race fingerprint. Original bytes are checked separately below. */
function sourceSnapshot(lookup: Lookup, scope: AccountScope): string {
  const photos = lookup.photos === undefined ? [{ ...lookup.frame, id: "photo-1", label: "overview" }] : lookup.photos;
  if (!Array.isArray(photos) || photos.length > 4 || new Set(photos.map((photo) => photo.id)).size !== photos.length) {
    throw new Error("The saved original photo references are incomplete. Your draft was kept; reopen the inspection.");
  }
  return canonical({ id: lookup.id, createdAt: lookup.createdAt, result: lookup.result ?? null, analysisAttemptId: lookup.analysisAttemptId ?? null,
    photos: photos.map((photo) => ({ id: photo.id, label: photo.label, capturedAt: photo.capturedAt,
      image: originalImageReference(photo.imageBase64, lookup.id, scope) ?? photo.imageBase64 })),
    photoRelationship: photoRelationshipOrUnknown(lookup.photoRelationship), vehicleContext: providerVehicleContext(lookup.vehicleContext) ?? null });
}
function readSaved(lookupId: string): Lookup {
  const saved = getLookup(lookupId);
  if (!saved) throw new Error("Save or restore this inspection on this device before recording its requested measurement. Your draft was kept.");
  return saved;
}
function assertSource(source: string, lookupId: string, scope: AccountScope, signal?: AbortSignal) {
  requireScope(scope, signal);
  if (sourceSnapshot(readSaved(lookupId), scope) !== source) throw new Error("The saved original or AI result changed. Your human draft was kept; reopen the inspection before continuing.");
}
async function analysisHash(lookup: Lookup, scope: AccountScope, signal?: AbortSignal): Promise<string> {
  const bytes = new TextEncoder().encode(analysisSnapshot(lookup));
  try {
    const digest = await boundedOriginalEvidenceOperation(scope, signal, () => crypto.subtle.digest("SHA-256", bytes));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { requireScope(scope, signal); throw new Error("The saved AI result could not be fingerprinted. Your draft was kept; retry before continuing."); }
}

export async function prepareRequestedMeasurement(lookup: Lookup, scope = getAccountScope(), signal?: AbortSignal): Promise<RequestedMeasurementReceipt> {
  requireScope(scope, signal);
  const saved = structuredClone(readSaved(lookup.id)), guide = requestedMeasurementGuideForLookup(saved);
  if (!guide) throw new Error("This saved inspection no longer has a valid measurement request. Reopen its current result.");
  const source = sourceSnapshot(saved, scope);
  if (sourceSnapshot(lookup, scope) !== source) throw new Error("The displayed inspection is out of date. Reopen its saved result before recording requested evidence.");
  const analysisSha256 = await analysisHash(saved, scope, signal);
  assertSource(source, saved.id, scope, signal);
  const references = [];
  for (const photoId of guide.photoIds) {
    const reference = await boundedOriginalEvidenceOperation(scope, signal, (requestSignal) => comparisonSideForLookup(saved, photoId, scope, requestSignal));
    assertSource(source, saved.id, scope, signal);
    references.push(reference);
  }
  const checked = normalizeRequestedMeasurementReceipt({ version: 1, guide, analysisSha256, references }, saved.id);
  if (!checked) throw new Error("The requested measurement could not be bound to its cited originals. No substitute reference or reading was used.");
  return checked;
}

/** New measurements verify the exact originating answer and every cited original.
 * A correction/retraction keeps its historical receipt even if that evidence changed;
 * historicalRequest must only be used with a validated immutable parent record. */
export async function verifyRequestedMeasurement(lookupId: string, receipt: RequestedMeasurementReceipt,
  scope = getAccountScope(), signal?: AbortSignal, historicalRequest = false): Promise<VerifiedRequestedMeasurement> {
  requireScope(scope, signal);
  const checked = normalizeRequestedMeasurementReceipt(receipt, lookupId);
  if (!checked) throw new Error("The requested-measurement reference is invalid. Its human draft was kept for review.");
  const saved = structuredClone(readSaved(lookupId)), source = sourceSnapshot(saved, scope);
  if (!historicalRequest) {
    if (canonical(requestedMeasurementGuideForLookup(saved)) !== canonical(checked.guide)) throw new Error("The saved measurement request changed. Your draft was kept; reopen the inspection.");
    const hash = await analysisHash(saved, scope, signal);
    assertSource(source, lookupId, scope, signal);
    if (hash !== checked.analysisSha256) throw new Error("The originating AI result changed. Your human draft was kept; review the new answer before starting another measurement.");
    for (const reference of checked.references) {
      const resolved = await resolveComparisonSide(reference, scope, signal);
      assertSource(source, lookupId, scope, signal);
      if (resolved.status !== "unchanged") throw new Error(`A cited original could not be verified. ${resolved.message} Your human draft was kept.`);
    }
  }
  assertSource(source, lookupId, scope, signal);
  const guard = Object.freeze({ lookupId, receipt: structuredClone(checked) });
  guards.set(guard, { scope: { ...scope }, source, receipt, canonicalReceipt: canonical(checked), signal });
  return guard;
}

/** Call inside the final device transaction, immediately before its write. */
export function assertRequestedMeasurementCurrent(guard: VerifiedRequestedMeasurement, scope = getAccountScope()): void {
  const proof = guards.get(guard);
  requireScope(scope, proof?.signal);
  if (!proof || !isAccountScopeCurrent(proof.scope) || proof.scope.userId !== scope.userId || proof.scope.generation !== scope.generation
    || canonical(normalizeRequestedMeasurementReceipt(proof.receipt, guard.lookupId)) !== proof.canonicalReceipt
    || canonical(normalizeRequestedMeasurementReceipt(guard.receipt, guard.lookupId)) !== proof.canonicalReceipt) {
    throw new Error("Requested-measurement verification is stale or unavailable. Your human draft was kept; review and retry.");
  }
  assertSource(proof.source, guard.lookupId, scope, proof.signal);
}
