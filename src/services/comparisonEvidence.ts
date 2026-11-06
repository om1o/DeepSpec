import { getAccountScope, type AccountScope } from "../lib/accountScope";
import { comparisonSideMatches, normalizeComparisonSide, normalizeComparisonTimestamp } from "../lib/inspectionComparison";
import { providerVehicleContext } from "../lib/vehicleContext";
import { photoRelationshipOrUnknown } from "../lib/photoRelationship";
import type { Lookup, ScanPhoto } from "../types";
import type { ComparisonSide } from "../types/inspectionComparison";
import { readCloudLookupForReport } from "./cloudHistory";
import { CLOUD_SYNC_DISABLED_MESSAGE, isCloudSyncEnabled } from "./cloudSyncPolicy";
import { getLookup, readLookups } from "./storage";
import { MAX_ORIGINAL_IMAGE_BYTES, OriginalEvidenceError as EvidenceError, boundedOriginalEvidenceOperation as bounded, guardOriginalEvidence as guard, inspectOriginalImage, originalImageReference, unavailableOriginal as unavailable, missingOriginal as missing, changedOriginal as changed } from "./originalImageEvidence";

export const MAX_COMPARISON_IMAGE_BYTES = MAX_ORIGINAL_IMAGE_BYTES;
export type ComparisonResolution = { status: "unchanged" | "source_changed" | "missing_photo" | "verification_unavailable"; image?: string; message: string };

export function comparisonPhotos(lookup: Lookup): ScanPhoto[] {
  return lookup.photos?.length ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" }];
}
function original(lookup: Lookup, photoId: string): ScanPhoto {
  const matches = comparisonPhotos(lookup).filter((photo) => photo.id === photoId);
  if (!matches.length) throw missing();
  if (matches.length !== 1) throw unavailable();
  return matches[0];
}
function metadata(lookup: Lookup, photo: ScanPhoto) {
  const photoAddedAt = normalizeComparisonTimestamp(photo.capturedAt), scanSavedAt = normalizeComparisonTimestamp(lookup.createdAt);
  if (!photoAddedAt || !scanSavedAt) throw unavailable();
  // Vehicle facts belong to the first photo unless the user explicitly groups
  // these as the same part/area. A secondary example must not inherit that car.
  const sharesVehicleContext = comparisonPhotos(lookup)[0]?.id === photo.id
    || photoRelationshipOrUnknown(lookup.photoRelationship) === "same_part_or_area";
  return { lookupId: lookup.id, photoId: photo.id, photoLabel: photo.label, photoAddedAt, scanSavedAt,
    vehicleContext: sharesVehicleContext ? providerVehicleContext(lookup.vehicleContext) ?? null : null,
    ...(lookup.analysisAttemptId === undefined ? {} : { analysisAttemptId: lookup.analysisAttemptId }) };
}
function signature(lookup: Lookup | null, photoId: string, scope: AccountScope): string {
  if (!lookup) return "absent";
  const photo = original(lookup, photoId);
  return JSON.stringify({ ...metadata(lookup, photo), image: originalImageReference(photo.imageBase64, lookup.id, scope) ?? photo.imageBase64 });
}
async function cloudLookup(id: string, scope: AccountScope, signal?: AbortSignal): Promise<Lookup | null> {
  if (!isCloudSyncEnabled()) throw new EvidenceError("verification_unavailable", CLOUD_SYNC_DISABLED_MESSAGE);
  const response = await bounded(scope, signal, () => readCloudLookupForReport(id));
  if (!response.ok) throw unavailable();
  if (response.value && response.value.id !== id) throw unavailable();
  return response.value ? structuredClone(response.value) : null;
}

async function inspect(lookup: Lookup, photoId: string, scope: AccountScope, signal?: AbortSignal) {
  guard(scope, signal); const photo = original(lookup, photoId);
  const inspected = await inspectOriginalImage(photo.imageBase64, lookup.id, scope, signal, async () => {
    const remote = await cloudLookup(lookup.id, scope, signal); if (!remote) throw missing();
    const refreshed = original(remote, photo.id);
    const refreshedAt = normalizeComparisonTimestamp(refreshed.capturedAt), originalAt = normalizeComparisonTimestamp(photo.capturedAt);
    if (!refreshedAt || !originalAt || refreshedAt !== originalAt || refreshed.label !== photo.label) throw changed();
    return refreshed.imageBase64;
  });
  const side = normalizeComparisonSide({ ...metadata(lookup, photo), width: inspected.width, height: inspected.height, sha256: inspected.sha256, observedOn: null });
  if (!side) throw unavailable();
  return { side, image: inspected.image };
}

/** Inspect only the chosen saved original; the caller owns saved-record race checks. */
export async function comparisonSideForLookup(lookup: Lookup, photoId: string, scope = getAccountScope(), signal?: AbortSignal): Promise<ComparisonSide> {
  guard(scope, signal);
  try { return (await inspect(structuredClone(lookup), photoId, scope, signal)).side; }
  catch (error) { guard(scope, signal); throw error instanceof EvidenceError ? error : unavailable(); }
}

export async function resolveComparisonSide(side: ComparisonSide, scope = getAccountScope(), signal?: AbortSignal): Promise<ComparisonResolution> {
  try {
    guard(scope, signal); const checked = normalizeComparisonSide(side); if (!checked) throw unavailable();
    const read = readLookups(); if (!read.ok) throw unavailable();
    const local = getLookup(checked.lookupId, read.value);
    const before = signature(local, checked.photoId, scope);
    const lookup = local ? structuredClone(local) : await cloudLookup(checked.lookupId, scope, signal); guard(scope, signal);
    if (!lookup) throw missing();
    const photo = original(lookup, checked.photoId);
    const meta = normalizeComparisonSide({ ...checked, ...metadata(lookup, photo) });
    if (!meta || !comparisonSideMatches(checked, meta)) throw changed();
    const result = await inspect(lookup, checked.photoId, scope, signal);
    if (!comparisonSideMatches(checked, result.side)) throw changed();
    const finalRead = readLookups(); guard(scope, signal); if (!finalRead.ok) throw unavailable();
    if (signature(getLookup(checked.lookupId, finalRead.value), checked.photoId, scope) !== before) throw changed();
    return { status: "unchanged", image: result.image, message: "This original's bytes and saved context match the historical reference. This does not establish vehicle identity, condition or repair success." };
  } catch (error) {
    let cause = error;
    try { guard(scope, signal); } catch (guardError) { cause = guardError; }
    const failure = cause instanceof EvidenceError ? cause : unavailable();
    return { status: failure.status, message: failure.message };
  }
}
