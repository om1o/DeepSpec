import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { buildConditionHandoff } from "../lib/conditionHandoff";
import { normalizeComparisonCaptureTarget, normalizeRequestedEvidenceGuide } from "../lib/inspectionComparison";
import { photoRelationshipOrUnknown } from "../lib/photoRelationship";
import { providerVehicleContext } from "../lib/vehicleContext";
import type { Lookup } from "../types";
import type { ComparisonCaptureTarget, RequestedEvidenceGuide } from "../types/inspectionComparison";
import { comparisonPhotos, comparisonSideForLookup, resolveComparisonSide } from "./comparisonEvidence";
import { boundedOriginalEvidenceOperation, originalImageReference } from "./originalImageEvidence";
import { getLookup } from "./storage";

type RequestedTarget = Extract<ComparisonCaptureTarget, { version: 2 }>;
export type RequestedEvidenceCaptureGuard = { readonly lookupId: string };
const guards = new WeakMap<RequestedEvidenceCaptureGuard, { scope: AccountScope; target: string; source: string }>();

function requireScope(scope: AccountScope, signal?: AbortSignal) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen the requested evidence in its original account.");
  if (signal?.aborted) throw new Error("Requested-photo preparation was canceled. Your saved inspection and photo draft were kept.");
}

/** Object ordering is immaterial; array order and every saved analysis value matter. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}

function analysisSnapshot(lookup: Lookup): string {
  if (!lookup.result) throw new Error("The saved AI result is unavailable. Reopen the inspection before collecting requested evidence.");
  const value = canonical({ result: lookup.result, analysisAttemptId: lookup.analysisAttemptId ?? null });
  if (new TextEncoder().encode(value).byteLength > 256 * 1024) throw new Error("The saved AI result is too large to verify safely. Your saved inspection was kept.");
  return value;
}

/** The UI and preparation use the same validated, photo-linked assessment. */
export function requestedEvidenceGuideForLookup(lookup: Lookup): RequestedEvidenceGuide | null {
  const review = buildConditionHandoff(lookup), next = review.nextEvidence;
  if (!next || (next.kind !== "photo" && next.kind !== "marking") || !review.photos.length) return null;
  return normalizeRequestedEvidenceGuide({ version: 1, kind: next.kind, request: next.request, purpose: next.purpose,
    photoIds: next.photoIds ?? [], ...(lookup.analysisAttemptId === undefined ? {} : { analysisAttemptId: lookup.analysisAttemptId }) }) ?? null;
}

function sourceSnapshot(lookup: Lookup, scope: AccountScope): string {
  const guide = requestedEvidenceGuideForLookup(lookup);
  if (!guide) throw new Error("This saved inspection no longer has a valid photo or marking request. Your draft was kept; reopen the inspection.");
  const allowed = buildConditionHandoff(lookup).photos;
  const photos = comparisonPhotos(lookup);
  if (allowed.length !== photos.length) throw new Error("The saved original photo references are incomplete. Reopen the inspection.");
  return canonical({ id: lookup.id, createdAt: lookup.createdAt, jobId: lookup.jobId ?? null, orgId: lookup.orgId ?? null, analysis: analysisSnapshot(lookup),
    photos: photos.map((photo) => ({ id: photo.id, label: photo.label, capturedAt: photo.capturedAt,
      image: originalImageReference(photo.imageBase64, lookup.id, scope) ?? photo.imageBase64 })),
    photoRelationship: photoRelationshipOrUnknown(lookup.photoRelationship), vehicleContext: providerVehicleContext(lookup.vehicleContext) ?? null });
}

function readSaved(lookupId: string): Lookup {
  const saved = getLookup(lookupId);
  if (!saved) throw new Error("Save or restore this inspection on this device before collecting its requested photo. Your draft was kept.");
  return saved;
}

async function analysisHash(lookup: Lookup, scope: AccountScope, signal?: AbortSignal): Promise<string> {
  const bytes = new TextEncoder().encode(analysisSnapshot(lookup));
  try {
    const digest = await boundedOriginalEvidenceOperation(scope, signal, () => crypto.subtle.digest("SHA-256", bytes));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { requireScope(scope, signal); throw new Error("The saved AI result could not be fingerprinted. Your saved inspection and draft were kept; retry before continuing."); }
}

function assertSource(source: string, lookupId: string, scope: AccountScope, signal?: AbortSignal) {
  requireScope(scope, signal);
  if (sourceSnapshot(readSaved(lookupId), scope) !== source) throw new Error("The saved original or AI result changed. Your photo draft was kept; reopen the inspection before continuing.");
}

export async function prepareRequestedEvidenceCapture(lookup: Lookup, requestedSnapshot: RequestedEvidenceGuide, chosenPhotoId: string,
  scope = getAccountScope(), signal?: AbortSignal): Promise<RequestedTarget> {
  requireScope(scope, signal);
  const requested = normalizeRequestedEvidenceGuide(requestedSnapshot);
  const saved = structuredClone(readSaved(lookup.id)), current = requestedEvidenceGuideForLookup(saved);
  if (!requested || !current || canonical(requested) !== canonical(current)) throw new Error("The requested photo changed. Reopen the inspection and review its current request.");
  const source = sourceSnapshot(saved, scope);
  if (sourceSnapshot(lookup, scope) !== source) throw new Error("The displayed inspection is out of date. Reopen its saved result before choosing requested evidence.");
  const allowed = buildConditionHandoff(saved).photos.map((photo) => photo.id);
  if (!allowed.includes(chosenPhotoId) || (requested.photoIds.length > 0 && !requested.photoIds.includes(chosenPhotoId))) {
    throw new Error("Choose one of the request's cited saved originals, or an actual saved original when no photo was cited.");
  }
  const analysisSha256 = await analysisHash(saved, scope, signal);
  assertSource(source, saved.id, scope, signal);
  const earlier = await boundedOriginalEvidenceOperation(scope, signal, () => comparisonSideForLookup(saved, chosenPhotoId, scope));
  assertSource(source, saved.id, scope, signal);
  if (earlier.lookupId !== saved.id || earlier.photoId !== chosenPhotoId) throw new Error("The selected original could not be prepared safely. No substitute reference was used.");
  const checked = normalizeComparisonCaptureTarget({ version: 2, comparisonId: crypto.randomUUID(), lookupId: crypto.randomUUID(),
    earlier, subject: requested.kind === "marking" ? "Requested marking photo" : "Requested evidence photo", requestedEvidence: requested, analysisSha256 });
  if (!checked || checked.version !== 2) throw new Error("The requested-photo reference could not be prepared safely. No new capture was started.");
  return checked;
}

/** Resume requires both the historical original and the exact originating AI answer. */
export async function verifyRequestedEvidenceCaptureReference(target: RequestedTarget, scope = getAccountScope(), signal?: AbortSignal): Promise<RequestedEvidenceCaptureGuard> {
  requireScope(scope, signal);
  const checked = normalizeComparisonCaptureTarget(target);
  if (!checked || checked.version !== 2) throw new Error("The requested-evidence capture reference is invalid. Its draft was kept for review.");
  const saved = structuredClone(readSaved(checked.earlier.lookupId));
  const source = sourceSnapshot(saved, scope), guide = requestedEvidenceGuideForLookup(saved);
  if (canonical(guide) !== canonical(checked.requestedEvidence)) throw new Error("The saved next-evidence request changed. Its pending photos were kept; reopen the inspection.");
  const hash = await analysisHash(saved, scope, signal);
  assertSource(source, saved.id, scope, signal);
  if (hash !== checked.analysisSha256) throw new Error("The originating AI result changed. Its pending photos were kept; reopen the inspection and review the new request.");
  const resolved = await resolveComparisonSide(checked.earlier, scope, signal);
  assertSource(source, saved.id, scope, signal);
  if (resolved.status !== "unchanged") throw new Error(`The earlier original could not be verified. ${resolved.message} Your requested-photo draft was kept.`);
  const guard = Object.freeze({ lookupId: saved.id });
  guards.set(guard, { scope: { ...scope }, target: canonical(checked), source });
  return guard;
}

/** Only an issued verification object may authorize the final synchronous mutation. */
export function assertRequestedEvidenceCaptureCurrent(guard: RequestedEvidenceCaptureGuard, target: RequestedTarget, scope = getAccountScope()): void {
  requireScope(scope);
  const proof = guards.get(guard), checked = normalizeComparisonCaptureTarget(target);
  if (!proof || !checked || checked.version !== 2 || !isAccountScopeCurrent(proof.scope)
    || proof.scope.userId !== scope.userId || proof.scope.generation !== scope.generation || canonical(checked) !== proof.target) {
    throw new Error("Requested-photo verification is stale or unavailable. Its draft was kept; review and retry.");
  }
  assertSource(proof.source, checked.earlier.lookupId, scope);
}
