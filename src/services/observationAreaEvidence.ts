import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeConditionAssessment } from "../lib/conditionAssessment";
import { normalizeObservationAreaBinding } from "../lib/observationArea";
import { photoRelationshipOrUnknown } from "../lib/photoRelationship";
import { providerVehicleContext } from "../lib/vehicleContext";
import type { Lookup } from "../types";
import type { ObservationAreaBinding } from "../types/observationArea";
import { comparisonPhotos, comparisonSideForLookup, resolveComparisonSide } from "./comparisonEvidence";
import { boundedOriginalEvidenceOperation, originalImageReference } from "./originalImageEvidence";
import { getLookup } from "./storage";

export type ObservationAreaVerificationMode = "current" | "historical" | "retraction";
export type ObservationAreaGuard = { readonly binding: ObservationAreaBinding; readonly mode: ObservationAreaVerificationMode };
const proofs = new WeakMap<ObservationAreaGuard, {
  scope: AccountScope; source: string; binding: ObservationAreaBinding; canonicalBinding: string; signal?: AbortSignal;
}>();
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);

function requireScope(scope: AccountScope, signal?: AbortSignal) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen this finding in its original account.");
  if (signal?.aborted) throw new Error("Area verification was canceled. Your saved history and draft were kept.");
}
function sourceSnapshot(lookup: Lookup | null, scope: AccountScope): string {
  if (!lookup) return "absent";
  const photos = comparisonPhotos(lookup);
  if (photos.length > 4 || new Set(photos.map((photo) => photo.id)).size !== photos.length) throw new Error("The original photo references are incomplete. Your draft was kept.");
  return canonical({ id: lookup.id, createdAt: lookup.createdAt, result: lookup.result ?? null, analysisAttemptId: lookup.analysisAttemptId ?? null,
    photos: photos.map((photo) => ({ id: photo.id, label: photo.label, capturedAt: photo.capturedAt,
      image: originalImageReference(photo.imageBase64, lookup.id, scope) ?? photo.imageBase64 })),
    photoRelationship: photoRelationshipOrUnknown(lookup.photoRelationship), vehicleContext: providerVehicleContext(lookup.vehicleContext) ?? null });
}
function assertSource(lookupId: string, source: string, scope: AccountScope, signal?: AbortSignal) {
  requireScope(scope, signal);
  if (sourceSnapshot(getLookup(lookupId), scope) !== source) throw new Error("The saved photo or AI result changed. Your area draft was kept; reopen the finding.");
}
function readSaved(lookupId: string): Lookup {
  const saved = getLookup(lookupId);
  if (!saved) throw new Error("Save or restore this inspection on this device before marking a finding. Your draft was kept.");
  return structuredClone(saved);
}
function observation(lookup: Lookup, observationId: string, photoId: string) {
  const assessment = normalizeConditionAssessment(lookup.result?.conditionAssessment, comparisonPhotos(lookup).map((photo) => photo.id));
  const item = assessment?.observations.find((entry) => entry.id === observationId);
  if (!item || !item.photoIds.includes(photoId)) throw new Error("This finding no longer cites that saved photo. Reopen the current result.");
  return item;
}

/** The whole answer and attempt, not only its mutable observation ID. */
export async function observationAnalysisSha256(lookup: Lookup, scope = getAccountScope(), signal?: AbortSignal): Promise<string> {
  if (!lookup.result) throw new Error("The saved AI result is unavailable. Your draft was kept.");
  const bytes = new TextEncoder().encode(canonical({ result: lookup.result, analysisAttemptId: lookup.analysisAttemptId ?? null }));
  if (bytes.byteLength > 256 * 1024) throw new Error("The saved AI result exceeds the verification limit. Your draft was kept.");
  requireScope(scope, signal);
  const digest = await boundedOriginalEvidenceOperation(scope, signal, () => crypto.subtle.digest("SHA-256", bytes));
  requireScope(scope, signal);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A newer answer does not change the pixels of a historical human outline.
 * Ignore only the attempt when checking those pixels; retain all original file
 * and vehicle metadata. The immutable binding itself is never rewritten. */
export function observationAreaReferenceForLookup(binding: ObservationAreaBinding, lookup: Lookup) {
  const reference = { ...binding.reference };
  delete reference.analysisAttemptId;
  return { ...reference, ...(lookup.analysisAttemptId === undefined ? {} : { analysisAttemptId: lookup.analysisAttemptId }) };
}

export async function prepareObservationAreaBinding(lookup: Lookup, observationId: string, photoId: string,
  scope = getAccountScope(), signal?: AbortSignal) {
  requireScope(scope, signal);
  const saved = readSaved(lookup.id), source = sourceSnapshot(saved, scope);
  if (sourceSnapshot(lookup, scope) !== source) throw new Error("The displayed inspection is out of date. Reopen its saved finding before marking an area.");
  const item = observation(saved, observationId, photoId);
  const analysisSha256 = await observationAnalysisSha256(saved, scope, signal);
  assertSource(saved.id, source, scope, signal);
  const reference = await boundedOriginalEvidenceOperation(scope, signal, (requestSignal) => comparisonSideForLookup(saved, photoId, scope, requestSignal));
  assertSource(saved.id, source, scope, signal);
  const binding = normalizeObservationAreaBinding({ version: 1, observation: item, analysisSha256, reference,
    ...(saved.analysisAttemptId === undefined ? {} : { analysisAttemptId: saved.analysisAttemptId }) });
  if (!binding || binding.reference.lookupId !== saved.id || binding.reference.photoId !== photoId) throw new Error("The finding could not be bound to its exact original photo. No substitute was used.");
  return { binding, ...await verifyObservationAreaBinding(binding, scope, signal) };
}

/** historical/retraction are only for validated immutable history entries.
 * Retraction adds no geometry and can remain possible after source removal. */
export async function verifyObservationAreaBinding(binding: ObservationAreaBinding, scope = getAccountScope(), signal?: AbortSignal,
  mode: ObservationAreaVerificationMode = "current"): Promise<{ image?: string; guard: ObservationAreaGuard }> {
  requireScope(scope, signal);
  const checked = normalizeObservationAreaBinding(binding);
  if (!checked) throw new Error("The saved observation-area reference is invalid. Your draft was kept.");
  const lookupId = checked.reference.lookupId;
  const saved = mode === "retraction" ? getLookup(lookupId) : readSaved(lookupId);
  const source = sourceSnapshot(saved, scope);
  if (mode === "current") {
    const item = observation(saved!, checked.observation.id, checked.reference.photoId);
    if (canonical(item) !== canonical(checked.observation) || await observationAnalysisSha256(saved!, scope, signal) !== checked.analysisSha256) {
      throw new Error("The originating AI finding changed. Your draft was kept; review its history or open the current finding.");
    }
    assertSource(lookupId, source, scope, signal);
  }
  let image: string | undefined;
  if (mode !== "retraction") {
    const reference = mode === "historical" ? observationAreaReferenceForLookup(checked, saved!) : checked.reference;
    const resolved = await boundedOriginalEvidenceOperation(scope, signal, (requestSignal) => resolveComparisonSide(reference, scope, requestSignal));
    assertSource(lookupId, source, scope, signal);
    if (resolved.status !== "unchanged" || !resolved.image) throw new Error(`The original photo could not be verified. ${resolved.message} Your draft was kept.`);
    image = resolved.image;
  }
  assertSource(lookupId, source, scope, signal);
  const guard = Object.freeze({ binding: structuredClone(checked), mode });
  proofs.set(guard, { scope: { ...scope }, source, binding, canonicalBinding: canonical(checked), signal });
  return { ...(image ? { image } : {}), guard };
}

/** Synchronous check immediately before the final IndexedDB transaction write. */
export function assertObservationAreaGuardCurrent(guard: ObservationAreaGuard, binding: ObservationAreaBinding, scope = getAccountScope()): void {
  const proof = proofs.get(guard);
  requireScope(scope, proof?.signal);
  if (!proof || proof.scope.userId !== scope.userId || proof.scope.generation !== scope.generation || !isAccountScopeCurrent(proof.scope)
    || [binding, guard.binding, proof.binding].some((value) => canonical(normalizeObservationAreaBinding(value)) !== proof.canonicalBinding)) {
    throw new Error("Area verification is stale or unavailable. Your draft was kept; verify the original again.");
  }
  assertSource(binding.reference.lookupId, proof.source, scope, proof.signal);
}
