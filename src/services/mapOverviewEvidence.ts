import { getAccountScope, type AccountScope } from "../lib/accountScope";
import { mapOverviewSourcesMatch, normalizeComponentMap, normalizeMapOverviewSource } from "../lib/componentMap";
import { normalizeComparisonTimestamp } from "../lib/inspectionComparison";
import type { Lookup, ScanPhoto } from "../types";
import type { ComponentMap, MapOverviewSource } from "../types/componentMap";
import { readCloudLookupForReport } from "./cloudHistory";
import { CLOUD_SYNC_DISABLED_MESSAGE, isCloudSyncEnabled } from "./cloudSyncPolicy";
import { getLookup, readLookups } from "./storage";
import { OriginalEvidenceError, boundedOriginalEvidenceOperation, guardOriginalEvidence, inspectOriginalImage, originalImageReference, unavailableOriginal, missingOriginal, changedOriginal } from "./originalImageEvidence";

export type MapOverviewSaveGuard = { lookupId: string; photoId: string; source: MapOverviewSource; deviceSignature: string };
export type MapOverviewVerification = {
  status: "unchanged" | "source_changed" | "missing_photo" | "verification_unavailable" | "legacy_unverified";
  message: string;
  image?: string;
  source?: MapOverviewSource;
  guard?: MapOverviewSaveGuard;
};
const issuedGuards = new WeakMap<MapOverviewSaveGuard, { scope: AccountScope; proof: string }>();
const photos = (lookup: Lookup): ScanPhoto[] => lookup.photos !== undefined ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" }];
function selectedPhoto(lookup: Lookup, photoId: string): ScanPhoto {
  const matches = photos(lookup).filter((photo) => photo.id === photoId);
  if (!matches.length || !matches[0].imageBase64) throw missingOriginal();
  if (matches.length !== 1) throw unavailableOriginal();
  return matches[0];
}
function dates(lookup: Lookup, photo: ScanPhoto) {
  const photoAddedAt = normalizeComparisonTimestamp(photo.capturedAt), scanSavedAt = normalizeComparisonTimestamp(lookup.createdAt);
  if (!photoAddedAt || !scanSavedAt) throw unavailableOriginal();
  return { photoAddedAt, scanSavedAt };
}
function sourceSignature(lookup: Lookup | null, photoId: string, scope: AccountScope): string {
  if (!lookup) return "absent";
  const photo = selectedPhoto(lookup, photoId);
  return JSON.stringify({ lookupId: lookup.id, photoId, firstPhotoId: photos(lookup)[0]?.id, ...dates(lookup, photo),
    image: originalImageReference(photo.imageBase64, lookup.id, scope) ?? photo.imageBase64 });
}
function localLookup(lookupId: string, scope: AccountScope): Lookup | null {
  guardOriginalEvidence(scope);
  const saved = readLookups();
  if (!saved.ok) throw unavailableOriginal();
  const lookup = getLookup(lookupId, saved.value);
  guardOriginalEvidence(scope);
  return lookup ? structuredClone(lookup) : null;
}
async function freshCloudLookup(lookupId: string, scope: AccountScope, signal?: AbortSignal): Promise<Lookup | null> {
  if (!isCloudSyncEnabled()) throw new OriginalEvidenceError("verification_unavailable", CLOUD_SYNC_DISABLED_MESSAGE);
  const response = await boundedOriginalEvidenceOperation(scope, signal, () => readCloudLookupForReport(lookupId));
  if (!response.ok || (response.value && response.value.id !== lookupId)) throw unavailableOriginal();
  return response.value ? structuredClone(response.value) : null;
}
function checkedDocument(document: ComponentMap | undefined, lookup: Lookup): ComponentMap | undefined {
  if (document === undefined) return undefined;
  const checked = normalizeComponentMap(document);
  if (!checked) throw unavailableOriginal();
  if (checked.overview.lookupId !== lookup.id) throw changedOriginal();
  return checked;
}
function failure(error: unknown, scope: AccountScope, signal?: AbortSignal): MapOverviewVerification {
  let cause = error;
  try { guardOriginalEvidence(scope, signal); } catch (guardError) { cause = guardError; }
  const failed = cause instanceof OriginalEvidenceError ? cause : unavailableOriginal();
  return { status: failed.status, message: failed.message };
}
async function inspect(lookup: Lookup, document: ComponentMap | undefined, photoId: string, scope: AccountScope, signal?: AbortSignal, refresh?: () => Promise<string>): Promise<MapOverviewVerification> {
  guardOriginalEvidence(scope, signal);
  const photo = selectedPhoto(lookup, photoId), timestamps = dates(lookup, photo);
  if (document?.version === 3 && (document.overview.source!.photoAddedAt !== timestamps.photoAddedAt || document.overview.source!.scanSavedAt !== timestamps.scanSavedAt)) throw changedOriginal();
  const image = await inspectOriginalImage(photo.imageBase64, lookup.id, scope, signal, refresh);
  const source = normalizeMapOverviewSource({ sha256: image.sha256, width: image.width, height: image.height, ...timestamps });
  if (!source) throw unavailableOriginal();
  if (document && document.version !== 3) return { status: "legacy_unverified", image: image.image,
    message: "This legacy map has no historical overview fingerprint. The unannotated saved image is available; its old outlines have not been verified or rebound." };
  if (document && !mapOverviewSourcesMatch(document.overview.source, source)) throw changedOriginal();
  return { status: "unchanged", image: image.image, source,
    message: document ? "The overview file bytes, dimensions and saved dates match this map. This does not confirm component identity, condition, completeness or linked-photo history."
      : "The saved overview file is ready to bind to a new map. This does not confirm the depicted components or their condition." };
}

/** Exact supplied source only: no device lookup, cloud lookup, token refresh or substitute image. */
export async function verifyMapOverviewImage(lookup: Lookup, document: ComponentMap, scope = getAccountScope(), signal?: AbortSignal): Promise<MapOverviewVerification> {
  try {
    guardOriginalEvidence(scope, signal);
    const displayed = structuredClone(lookup), checked = checkedDocument(document, displayed)!;
    return await inspect(displayed, checked, checked.overview.photoId, scope, signal);
  } catch (error) { return failure(error, scope, signal); }
}

/** Resolve the displayed saved overview and retain an ephemeral synchronous save guard. */
export async function resolveMapOverview(lookup: Lookup, document: ComponentMap | undefined, scope = getAccountScope(), signal?: AbortSignal, requireLocal = false): Promise<MapOverviewVerification> {
  try {
    guardOriginalEvidence(scope, signal);
    const displayed = structuredClone(lookup), checked = checkedDocument(document, displayed);
    const photoId = checked?.overview.photoId ?? photos(displayed)[0]?.id;
    if (!photoId) throw missingOriginal();
    const displayedSignature = sourceSignature(displayed, photoId, scope);
    const local = localLookup(displayed.id, scope);
    if (requireLocal && !local) throw missingOriginal();
    const deviceSignature = sourceSignature(local, photoId, scope);
    const saved = local ?? await freshCloudLookup(displayed.id, scope, signal);
    guardOriginalEvidence(scope, signal);
    if (!saved) throw missingOriginal();
    if (sourceSignature(saved, photoId, scope) !== displayedSignature) throw changedOriginal();
    const result = await inspect(saved, checked, photoId, scope, signal, async () => {
      const refreshed = await freshCloudLookup(saved.id, scope, signal);
      if (!refreshed) throw missingOriginal();
      // Ignore changing labels/AI/vehicle facts; never accept a different object,
      // timestamp, first-photo selection or non-token option during renewal.
      if (sourceSignature(refreshed, photoId, scope) !== displayedSignature) throw changedOriginal();
      return selectedPhoto(refreshed, photoId).imageBase64;
    });
    guardOriginalEvidence(scope, signal);
    if (sourceSignature(localLookup(displayed.id, scope), photoId, scope) !== deviceSignature) throw changedOriginal();
    if (result.status !== "unchanged" || !result.source) return result;
    const guard: MapOverviewSaveGuard = { lookupId: saved.id, photoId, source: result.source, deviceSignature };
    issuedGuards.set(guard, { scope: { ...scope }, proof: JSON.stringify(guard) });
    return { ...result, guard };
  } catch (error) { return failure(error, scope, signal); }
}

/** Synchronous CAS-boundary check. It does not hash/fetch inside an IndexedDB transaction. */
export function assertMapOverviewGuardCurrent(guard: MapOverviewSaveGuard, document: ComponentMap, scope = getAccountScope()): void {
  guardOriginalEvidence(scope);
  const issued = issuedGuards.get(guard);
  if (!issued || issued.scope.userId !== scope.userId || issued.scope.generation !== scope.generation || JSON.stringify(guard) !== issued.proof) throw unavailableOriginal();
  guardOriginalEvidence(issued.scope);
  const checked = normalizeComponentMap(document);
  if (!checked || checked.version !== 3 || checked.id !== guard.lookupId || checked.overview.photoId !== guard.photoId
    || !mapOverviewSourcesMatch(checked.overview.source, guard.source)) throw changedOriginal();
  if (sourceSignature(localLookup(guard.lookupId, scope), guard.photoId, scope) !== guard.deviceSignature) throw changedOriginal();
}
