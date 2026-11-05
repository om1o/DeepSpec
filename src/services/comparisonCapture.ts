import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeComparisonCaptureTarget, normalizeComparisonTimestamp, normalizeInspectionComparison } from "../lib/inspectionComparison";
import { providerVehicleContext } from "../lib/vehicleContext";
import type { Lookup } from "../types";
import type { ComparisonCaptureTarget, InspectionComparison } from "../types/inspectionComparison";
import { comparisonPhotos, comparisonSideForLookup, resolveComparisonSide } from "./comparisonEvidence";
import { appendInspectionComparison, readInspectionComparisons } from "./inspectionComparisonStore";
import { getLookup } from "./storage";

function requireScope(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Resume these photos in their original account.");
}

export async function verifyComparisonCaptureReference(target: ComparisonCaptureTarget, scope = getAccountScope(), signal?: AbortSignal): Promise<void> {
  requireScope(scope);
  const checked = normalizeComparisonCaptureTarget(target);
  if (!checked) throw new Error("The dated comparison reference is invalid. Your photo draft was kept.");
  const resolved = await resolveComparisonSide(checked.earlier, scope, signal);
  requireScope(scope);
  if (signal?.aborted) throw new DOMException("Comparison verification canceled.", "AbortError");
  if (resolved.status !== "unchanged") throw new Error(`The earlier original could not be verified. ${resolved.message} Your new photos were kept; reopen the earlier scan before continuing.`);
}

function captureIdentity(lookup: Lookup) {
  const photo = comparisonPhotos(lookup)[0];
  return JSON.stringify({ id: lookup.id, createdAt: lookup.createdAt, photo: photo && {
    id: photo.id, label: photo.label, capturedAt: photo.capturedAt, imageBase64: photo.imageBase64 },
    vehicleContext: providerVehicleContext(lookup.vehicleContext) ?? null, analysisAttemptId: lookup.analysisAttemptId });
}

function comparisonMatchesExpected(record: InspectionComparison, expected: InspectionComparison): boolean {
  const normalized = normalizeInspectionComparison(record);
  const canonicalTimes = (value: InspectionComparison) => ({
    ...value, recordedAt: normalizeComparisonTimestamp(value.recordedAt),
    earlier: { ...value.earlier, photoAddedAt: normalizeComparisonTimestamp(value.earlier.photoAddedAt), scanSavedAt: normalizeComparisonTimestamp(value.earlier.scanSavedAt) },
    current: { ...value.current, photoAddedAt: normalizeComparisonTimestamp(value.current.photoAddedAt), scanSavedAt: normalizeComparisonTimestamp(value.current.scanSavedAt) },
  });
  return Boolean(normalized && JSON.stringify(canonicalTimes(normalized)) === JSON.stringify(canonicalTimes(expected)));
}

/** Commit the initial comparison before the exact photo draft can be retired.
 * A reserved saved scan is sufficient for recovery, including saved AI failures.
 * This operation never re-runs analysis or changes the saved scan/history. */
export async function completeComparisonCapture(target: ComparisonCaptureTarget, saved: Lookup, scope = getAccountScope(), signal?: AbortSignal): Promise<InspectionComparison> {
  requireScope(scope);
  const checked = normalizeComparisonCaptureTarget(target);
  if (!checked || saved.id !== checked.lookupId) throw new Error("The saved scan does not match this dated comparison. Both records were kept.");
  const recordedAt = normalizeComparisonTimestamp(saved.createdAt);
  if (!recordedAt) throw new Error("The saved scan timestamp is invalid. Your photo draft was kept for review.");
  const identity = captureIdentity(saved);
  const requireCurrentSaved = () => {
    requireScope(scope);
    if (signal?.aborted) throw new DOMException("Comparison completion canceled.", "AbortError");
    const current = getLookup(saved.id);
    if (!current || captureIdentity(current) !== identity) throw new Error("The saved follow-up evidence changed. Its photo draft was kept for review.");
  };
  requireCurrentSaved();
  const photo = comparisonPhotos(saved)[0];
  if (!photo) throw new Error("The follow-up original is unavailable. Your photo draft was kept.");
  const current = await comparisonSideForLookup(saved, photo.id, scope);
  requireCurrentSaved();
  const expected = normalizeInspectionComparison({
    version: 1, id: checked.comparisonId, lookupId: saved.id, recordedAt,
    subject: checked.subject, earlier: checked.earlier, current,
    relationship: { sameVehicle: false, component: "unconfirmed", basis: "" },
    conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "" },
    observation: { outcome: "not_reviewed", notes: "" },
    alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 },
  });
  if (!expected) throw new Error("The saved comparison references are incomplete. Your photo draft was kept.");
  const records = await readInspectionComparisons(saved.id, scope);
  requireCurrentSaved();
  const existing = records.find((record) => record.id === expected.id);
  if (existing) {
    if (!comparisonMatchesExpected(existing, expected)) throw new Error("This comparison ID already has different evidence or details. Existing history and your photo draft were preserved.");
    return existing;
  }
  await verifyComparisonCaptureReference(checked, scope, signal);
  requireCurrentSaved();
  const committed = await appendInspectionComparison(expected, scope);
  requireCurrentSaved();
  const result = committed.find((record) => record.id === expected.id);
  if (!result || !comparisonMatchesExpected(result, expected)) throw new Error("The dated comparison was not confirmed saved. Resume its photo draft to retry.");
  return result;
}
