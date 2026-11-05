import { getAccountScope, type AccountScope } from "../lib/accountScope";
import { componentMapGroupBindingsMatch, mapOverviewSourcesMatch, normalizeComponentMapGroupBinding, normalizeMapOverviewSource } from "../lib/componentMap";
import { normalizeComparisonTimestamp } from "../lib/inspectionComparison";
import { isPhotoRelationship } from "../lib/photoRelationship";
import { SCAN_PHOTO_LABELS, type Lookup, type PhotoRelationship, type ScanPhoto, type ScanPhotoLabel } from "../types";
import type { ComponentMapGroupBinding, ComponentMapScanGroup, MapOverviewSource } from "../types/componentMap";
import { readCloudLookupForReport } from "./cloudHistory";
import { CLOUD_SYNC_DISABLED_MESSAGE, isCloudSyncEnabled } from "./cloudSyncPolicy";
import { getLookup, readLookups } from "./storage";
import { OriginalEvidenceError, boundedOriginalEvidenceOperation, changedOriginal, guardOriginalEvidence, inspectOriginalImage, missingOriginal, originalImageReference, unavailableOriginal } from "./originalImageEvidence";

export type LinkedPhotoSaveGuard = { lookupId: string; binding: ComponentMapGroupBinding; deviceSignature: string };
export type LinkedPhotoVerification = {
  photoId: string;
  label?: ScanPhotoLabel;
  source?: MapOverviewSource;
  status: "unchanged" | "source_changed" | "missing_photo" | "verification_unavailable" | "legacy_unverified";
  message: string;
  image?: string;
  currentMetadataChanged?: boolean;
};
export type LinkedPhotoGroupVerification = { photos: LinkedPhotoVerification[]; photoRelationship: PhotoRelationship; legacy: boolean };
const issuedGuards = new WeakMap<LinkedPhotoSaveGuard, { scope: AccountScope; proof: string }>();
const photos = (lookup: Lookup): ScanPhoto[] => lookup.photos !== undefined ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" }];
function relationship(lookup: Lookup): PhotoRelationship {
  if (lookup.photoRelationship === undefined) return "unknown";
  if (!isPhotoRelationship(lookup.photoRelationship)) throw unavailableOriginal();
  return lookup.photoRelationship;
}
function checkedIds(ids: readonly string[]): string[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 4 || new Set(ids).size !== ids.length
    || !ids.every((id) => typeof id === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(id))) throw unavailableOriginal();
  return [...ids];
}
function selected(lookup: Lookup, photoId: string): ScanPhoto {
  const matches = photos(lookup).filter((photo) => photo.id === photoId);
  if (!matches.length || !matches[0].imageBase64) throw missingOriginal();
  if (matches.length !== 1 || !SCAN_PHOTO_LABELS.includes(matches[0].label)) throw unavailableOriginal();
  return matches[0];
}
function dates(lookup: Lookup, photo: ScanPhoto) {
  const photoAddedAt = normalizeComparisonTimestamp(photo.capturedAt), scanSavedAt = normalizeComparisonTimestamp(lookup.createdAt);
  if (!photoAddedAt || !scanSavedAt) throw unavailableOriginal();
  return { photoAddedAt, scanSavedAt };
}
function checkOrder(lookup: Lookup, ids: readonly string[]) {
  const positions = ids.map((id) => photos(lookup).findIndex((photo) => photo.id === id)).filter((index) => index >= 0);
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) throw changedOriginal();
}
function signature(lookup: Lookup | null, ids: readonly string[], scope: AccountScope, tolerateMissing = false): string {
  if (!lookup) return "absent";
  // Labels/relationship are frozen at linking, so a concurrent edit must not be
  // acknowledged with old metadata. Later verification reports them separately.
  return JSON.stringify({ lookupId: lookup.id, createdAt: normalizeComparisonTimestamp(lookup.createdAt), order: photos(lookup).map((photo) => photo.id), photoRelationship: relationship(lookup),
    photos: ids.map((id) => { if (tolerateMissing && !photos(lookup).some((photo) => photo.id === id && photo.imageBase64)) return { photoId: id, missing: true };
      const photo = selected(lookup, id); return { photoId: id, label: photo.label, ...dates(lookup, photo),
      image: originalImageReference(photo.imageBase64, lookup.id, scope) ?? photo.imageBase64 }; }) });
}
function localLookup(id: string, scope: AccountScope): Lookup | null {
  guardOriginalEvidence(scope); const saved = readLookups();
  if (!saved.ok) throw unavailableOriginal();
  const lookup = getLookup(id, saved.value); guardOriginalEvidence(scope);
  return lookup ? structuredClone(lookup) : null;
}
async function cloudLookup(id: string, scope: AccountScope, signal?: AbortSignal): Promise<Lookup | null> {
  if (!isCloudSyncEnabled()) throw new OriginalEvidenceError("verification_unavailable", CLOUD_SYNC_DISABLED_MESSAGE);
  const read = await boundedOriginalEvidenceOperation(scope, signal, () => readCloudLookupForReport(id));
  if (!read.ok || (read.value && read.value.id !== id)) throw unavailableOriginal();
  return read.value ? structuredClone(read.value) : null;
}
function groupBinding(group: ComponentMapScanGroup): ComponentMapGroupBinding | undefined {
  checkedIds(group.photoIds);
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(group.lookupId)) throw unavailableOriginal();
  if (!Object.prototype.hasOwnProperty.call(group, "binding")) return undefined;
  const binding = normalizeComponentMapGroupBinding(group.binding, group.photoIds);
  if (!binding) throw unavailableOriginal();
  return binding;
}
function failure(error: unknown, scope: AccountScope, signal?: AbortSignal) {
  let cause = error;
  try { guardOriginalEvidence(scope, signal); } catch (guardError) { cause = guardError; }
  return cause instanceof OriginalEvidenceError ? cause : unavailableOriginal();
}
function failedGroup(group: ComponentMapScanGroup, error: unknown, scope: AccountScope, signal?: AbortSignal): LinkedPhotoGroupVerification {
  const cause = failure(error, scope, signal);
  const binding = normalizeComponentMapGroupBinding(group.binding, group.photoIds);
  return { legacy: !binding, photoRelationship: binding?.photoRelationship ?? "unknown", photos: group.photoIds.map((photoId) => {
    const saved = binding?.photos.find((photo) => photo.photoId === photoId);
    return { photoId, ...(saved ? { label: saved.label, source: saved.source } : {}), status: cause.status, message: cause.message };
  }) };
}
async function inspectGroup(lookup: Lookup | null, group: ComponentMapScanGroup, scope: AccountScope, signal?: AbortSignal,
  refresh?: (photoId: string) => Promise<string>): Promise<LinkedPhotoGroupVerification> {
  guardOriginalEvidence(scope, signal); const binding = groupBinding(group);
  if (!lookup) throw missingOriginal();
  if (lookup.id !== group.lookupId) throw changedOriginal();
  checkOrder(lookup, group.photoIds); const currentRelationship = relationship(lookup);
  const rows: LinkedPhotoVerification[] = [];
  for (const photoId of group.photoIds) {
    const saved = binding?.photos.find((photo) => photo.photoId === photoId);
    const historical = saved ? { label: saved.label, source: saved.source } : {};
    let currentMetadataChanged: boolean | undefined;
    try {
      guardOriginalEvidence(scope, signal); const photo = selected(lookup, photoId);
      if (saved) currentMetadataChanged = saved.label !== photo.label || binding!.photoRelationship !== currentRelationship;
      const timestamps = dates(lookup, photo);
      if (saved && (saved.source.photoAddedAt !== timestamps.photoAddedAt || saved.source.scanSavedAt !== timestamps.scanSavedAt)) throw changedOriginal();
      const inspected = await inspectOriginalImage(photo.imageBase64, lookup.id, scope, signal, refresh ? () => refresh(photoId) : undefined);
      const source = normalizeMapOverviewSource({ sha256: inspected.sha256, width: inspected.width, height: inspected.height, ...timestamps });
      if (!source) throw unavailableOriginal();
      if (saved && !mapOverviewSourcesMatch(saved.source, source)) throw changedOriginal();
      rows.push({ photoId, ...historical, image: inspected.image, status: saved ? "unchanged" : "legacy_unverified",
        ...(saved ? { currentMetadataChanged } : {}),
        message: saved ? "These file bytes, dimensions and saved dates match the linked original. This does not verify the component, vehicle or condition."
          : "This ID-only link has no historical file fingerprint. This is the current saved image; it has not been rebound or verified as the linked original." });
    } catch (error) { const cause = failure(error, scope, signal); rows.push({ photoId, ...historical, status: cause.status, message: cause.message,
      ...(currentMetadataChanged === undefined ? {} : { currentMetadataChanged }) }); }
  }
  // Never return earlier successful images after an account change/cancellation.
  guardOriginalEvidence(scope, signal);
  return { photos: rows, photoRelationship: binding?.photoRelationship ?? "unknown", legacy: !binding };
}

/** Inspect exact supplied materialized/remote evidence only; never substitute a device copy. */
export async function verifyLinkedPhotoGroup(lookup: Lookup | null, group: ComponentMapScanGroup, scope = getAccountScope(), signal?: AbortSignal): Promise<LinkedPhotoGroupVerification> {
  const frozen = structuredClone(group);
  try { return await inspectGroup(lookup ? structuredClone(lookup) : null, frozen, scope, signal); }
  catch (error) { return failedGroup(frozen, error, scope, signal); }
}

/** Fresh owner-scoped resolution; a present device scan never falls back after deletion. */
export async function resolveLinkedPhotoGroup(group: ComponentMapScanGroup, scope = getAccountScope(), signal?: AbortSignal, requireLocal = false): Promise<LinkedPhotoGroupVerification> {
  const frozen = structuredClone(group);
  try {
    guardOriginalEvidence(scope, signal); groupBinding(frozen);
    const local = localLookup(frozen.lookupId, scope), before = signature(local, frozen.photoIds, scope, true);
    if (requireLocal && !local) throw missingOriginal();
    const lookup = local ?? await cloudLookup(frozen.lookupId, scope, signal);
    if (!lookup) throw missingOriginal();
    const sourceBefore = signature(lookup, frozen.photoIds, scope, true);
    const result = await inspectGroup(lookup, frozen, scope, signal, async (photoId) => {
      const renewed = await cloudLookup(frozen.lookupId, scope, signal);
      if (!renewed) throw missingOriginal();
      if (signature(renewed, frozen.photoIds, scope, true) !== sourceBefore) throw changedOriginal();
      return selected(renewed, photoId).imageBase64;
    });
    guardOriginalEvidence(scope, signal);
    if (!local) {
      const after = await cloudLookup(frozen.lookupId, scope, signal);
      if (!after) throw missingOriginal();
      if (signature(after, frozen.photoIds, scope, true) !== sourceBefore) throw changedOriginal();
    }
    if (signature(localLookup(frozen.lookupId, scope), frozen.photoIds, scope, true) !== before) throw changedOriginal();
    guardOriginalEvidence(scope, signal); return result;
  } catch (error) { return failedGroup(frozen, error, scope, signal); }
}

export async function prepareLinkedPhotoBinding(lookup: Lookup, photoIds: readonly string[], scope = getAccountScope(), signal?: AbortSignal, requireLocal = true): Promise<{ binding: ComponentMapGroupBinding; guard: LinkedPhotoSaveGuard }> {
  guardOriginalEvidence(scope, signal); const ids = checkedIds(photoIds), displayed = structuredClone(lookup);
  checkOrder(displayed, ids); const expected = signature(displayed, ids, scope);
  const local = localLookup(displayed.id, scope), deviceSignature = signature(local, ids, scope);
  if (requireLocal && !local) throw missingOriginal();
  const saved = local ?? await cloudLookup(displayed.id, scope, signal);
  if (!saved || signature(saved, ids, scope) !== expected) throw changedOriginal();
  const boundPhotos: ComponentMapGroupBinding["photos"] = [];
  for (const photoId of ids) {
    const photo = selected(saved, photoId);
    const inspected = await inspectOriginalImage(photo.imageBase64, saved.id, scope, signal, async () => {
      const renewed = await cloudLookup(saved.id, scope, signal);
      if (!renewed || signature(renewed, ids, scope) !== expected) throw changedOriginal();
      return selected(renewed, photoId).imageBase64;
    });
    const source = normalizeMapOverviewSource({ sha256: inspected.sha256, width: inspected.width, height: inspected.height, ...dates(saved, photo) });
    if (!source) throw unavailableOriginal();
    boundPhotos.push({ photoId, label: photo.label, source });
  }
  guardOriginalEvidence(scope, signal);
  if (!local) {
    const after = await cloudLookup(saved.id, scope, signal);
    if (!after || signature(after, ids, scope) !== expected) throw changedOriginal();
  }
  if (signature(localLookup(saved.id, scope), ids, scope) !== deviceSignature) throw changedOriginal();
  const binding = normalizeComponentMapGroupBinding({ version: 1, photoRelationship: relationship(saved), photos: boundPhotos }, ids);
  if (!binding) throw unavailableOriginal();
  const guard: LinkedPhotoSaveGuard = { lookupId: saved.id, binding: structuredClone(binding), deviceSignature };
  issuedGuards.set(guard, { scope: { ...scope }, proof: JSON.stringify(guard) });
  return { binding, guard };
}

/** Synchronous transaction-boundary check; guards are ephemeral and cannot be cloned/serialized. */
export function assertLinkedPhotoGuardCurrent(guard: LinkedPhotoSaveGuard, lookupId: string, binding: ComponentMapGroupBinding, scope = getAccountScope()): void {
  guardOriginalEvidence(scope); const issued = issuedGuards.get(guard);
  if (!issued || issued.scope.userId !== scope.userId || issued.scope.generation !== scope.generation || issued.proof !== JSON.stringify(guard)) throw unavailableOriginal();
  guardOriginalEvidence(issued.scope);
  if (guard.lookupId !== lookupId || !componentMapGroupBindingsMatch(guard.binding, binding)) throw changedOriginal();
  if (signature(localLookup(lookupId, scope), binding.photos.map((photo) => photo.photoId), scope) !== guard.deviceSignature) throw changedOriginal();
}
