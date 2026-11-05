import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { SCAN_PHOTO_LABELS, type PhotoRelationship, type ScanPhoto, type ShopVehicleContext } from "../types";
import { isPhotoRelationship, photoRelationshipOrUnknown } from "../lib/photoRelationship";
import { normalizeVehicleContext, vehicleContextsMatch } from "../lib/vehicleContext";
import type { ComponentCaptureTarget } from "../types/componentMap";
import { normalizeComponentCaptureTarget } from "../lib/componentMap";
import type { ComparisonCaptureTarget } from "../types/inspectionComparison";
import { normalizeComparisonCaptureTarget } from "../lib/inspectionComparison";
import { openEvidenceDatabase } from "./evidenceDb";

const STORE = "photo-drafts";
export const MAX_INSPECTION_PHOTOS = 4;
export type PhotoDraftKind = "upload" | "capture";
export type PhotoDraftEnvelope = { photos: ScanPhoto[]; target?: ComponentCaptureTarget } & (
  | { version: 2; photoRelationship?: undefined }
  | { version: 3; photoRelationship?: undefined; vehicleContext: ShopVehicleContext | null; jobId?: string }
  | { version: 4; photoRelationship?: undefined; vehicleContext: ShopVehicleContext | null; jobId?: string; comparisonTarget: ComparisonCaptureTarget }
  | { version: 5; photoRelationship: PhotoRelationship }
  | { version: 6; photoRelationship: PhotoRelationship; vehicleContext: ShopVehicleContext | null; jobId?: string }
  | { version: 7; photoRelationship: PhotoRelationship; vehicleContext: ShopVehicleContext | null; jobId?: string; comparisonTarget: ComparisonCaptureTarget }
);
export type ModernPhotoDraftEnvelope = Extract<PhotoDraftEnvelope, { version: 5 | 6 | 7 }>;

export function hasPhotoDraftContext(draft: PhotoDraftEnvelope | null | undefined): draft is Extract<PhotoDraftEnvelope, { version: 3 | 4 | 6 | 7 }> {
  return Boolean(draft && [3, 4, 6, 7].includes(draft.version));
}

export function hasPhotoDraftComparison(draft: PhotoDraftEnvelope | null | undefined): draft is Extract<PhotoDraftEnvelope, { version: 4 | 7 }> {
  return draft?.version === 4 || draft?.version === 7;
}

export function normalizePhotoDraft(value: unknown): PhotoDraftEnvelope | null {
  if (validatePhotoGroup(value)) return { version: 2, photos: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (![2, 3, 4, 5, 6, 7].includes(draft.version as number) || !validatePhotoGroup(draft.photos)) return null;
  const modern = [5, 6, 7].includes(draft.version as number);
  if (modern ? !isPhotoRelationship(draft.photoRelationship) : draft.photoRelationship !== undefined) return null;
  const comparison = draft.version === 4 || draft.version === 7;
  const comparisonTarget = comparison ? normalizeComparisonCaptureTarget(draft.comparisonTarget) : undefined;
  if ((comparison && !comparisonTarget) || (!comparison && draft.comparisonTarget !== undefined)) return null;
  const target = draft.target === undefined ? undefined : normalizeComponentCaptureTarget(draft.target);
  if (target === null || (target && comparisonTarget && target.lookupId !== comparisonTarget.lookupId)) return null;
  const common = { photos: draft.photos, ...(target ? { target } : {}) };
  const photoRelationship = photoRelationshipOrUnknown(draft.photoRelationship);
  if (draft.version === 2) return { version: 2, ...common };
  if (draft.version === 5) return { version: 5, ...common, photoRelationship };
  if (draft.jobId !== undefined && (typeof draft.jobId !== "string" || !/^[a-zA-Z0-9._:-]{1,120}$/.test(draft.jobId))) return null;
  const job = draft.jobId ? { jobId: draft.jobId } : {};
  const vehicleContext = draft.vehicleContext === null ? null : normalizeVehicleContext(draft.vehicleContext);
  if (vehicleContext === undefined) return null;
  if (modern) return comparisonTarget ? { version: 7, ...common, ...job, vehicleContext, comparisonTarget, photoRelationship }
    : { version: 6, ...common, ...job, vehicleContext, photoRelationship };
  return comparisonTarget ? { version: 4, ...common, ...job, vehicleContext, comparisonTarget }
    : { version: 3, ...common, ...job, vehicleContext };
}

/** New writes use versions older clients reject instead of dropping relationship metadata. */
export function upgradePhotoDraft(draft: PhotoDraftEnvelope): ModernPhotoDraftEnvelope {
  const normalized = normalizePhotoDraft(draft);
  if (!normalized) throw new Error("The photo draft could not be upgraded safely. Its originals were preserved.");
  const photoRelationship = photoRelationshipOrUnknown(normalized.photoRelationship);
  if (hasPhotoDraftComparison(normalized)) return { ...normalized, version: 7, photoRelationship };
  if (hasPhotoDraftContext(normalized)) return { ...normalized, version: 6, photoRelationship };
  return { ...normalized, version: 5, photoRelationship };
}

export function comparisonCaptureTargetsMatch(left?: ComparisonCaptureTarget, right?: ComparisonCaptureTarget): boolean {
  if (!left || !right) return left === right;
  const a = normalizeComparisonCaptureTarget(left), b = normalizeComparisonCaptureTarget(right);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

export function componentCaptureTargetsMatch(left?: ComponentCaptureTarget, right?: ComponentCaptureTarget): boolean {
  if (!left || !right) return left === right;
  return left.mapId === right.mapId && left.componentId === right.componentId
    && left.linkAttemptId === right.linkAttemptId && left.lookupId === right.lookupId;
}

export function photoDraftsMatch(left: PhotoDraftEnvelope, right: PhotoDraftEnvelope): boolean {
  if (!normalizePhotoDraft(left) || !normalizePhotoDraft(right)) return false;
  return left.version === right.version
    && photoRelationshipOrUnknown(left.photoRelationship) === photoRelationshipOrUnknown(right.photoRelationship)
    && (!hasPhotoDraftContext(left) || (hasPhotoDraftContext(right) && left.jobId === right.jobId && vehicleContextsMatch(left.vehicleContext, right.vehicleContext)))
    && comparisonCaptureTargetsMatch(hasPhotoDraftComparison(left) ? left.comparisonTarget : undefined, hasPhotoDraftComparison(right) ? right.comparisonTarget : undefined)
    && componentCaptureTargetsMatch(left.target, right.target) && photoGroupsMatch(left.photos, right.photos);
}

export function validatePhotoGroup(photos: unknown): photos is ScanPhoto[] {
  return Array.isArray(photos) && photos.length > 0 && photos.length <= MAX_INSPECTION_PHOTOS
    && new Set(photos.map((photo: ScanPhoto) => photo?.id)).size === photos.length
    && photos.every((photo: ScanPhoto) => photo && /^[a-zA-Z0-9._:-]{1,80}$/.test(photo.id)
      && SCAN_PHOTO_LABELS.includes(photo.label)
      && typeof photo.capturedAt === "string" && Number.isFinite(Date.parse(photo.capturedAt))
      && typeof photo.imageBase64 === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(photo.imageBase64));
}

// IndexedDB avoids putting several full photographs in the small localStorage quota.
// One transaction owns the whole group, so a failed save cannot replace a good draft.
async function draftRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, owner: string) => IDBRequest<T>, scope: AccountScope): Promise<T> {
  if (!isAccountScopeCurrent(scope)) throw new Error("Sign in to the account that owns these photos.");
  if (typeof indexedDB === "undefined") throw new Error("This browser cannot save a photo draft. Enable site storage and retry.");
  const database = await openEvidenceDatabase();
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction | undefined;
    let done = false;
    const finish = (error?: Error, value?: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      database?.close();
      if (error) reject(error); else resolve(value as T);
    };
    const timer = setTimeout(() => {
      try { transaction?.abort(); } catch { /* A completed transaction cannot be aborted. */ }
      finish(new Error("Saving photos stalled. Your previous draft is preserved. Retry after reopening DeepSpec."));
    }, 15_000);
    {
      if (!isAccountScopeCurrent(scope)) { finish(new Error("Account changed. Photos were not saved to another account.")); return; }
      try {
        transaction = database.transaction(STORE, mode);
        const request = operation(transaction.objectStore(STORE), scope.userId!);
        transaction.oncomplete = () => isAccountScopeCurrent(scope)
          ? finish(undefined, request.result)
          : finish(new Error("Account changed. Reopen the draft in its original account."));
        transaction.onerror = () => finish(new Error("Photos could not be saved. Free device space and retry; the previous draft is preserved."));
        transaction.onabort = () => finish(new Error("Photo storage was interrupted. Retry saving before analysis."));
      } catch {
        try { transaction?.abort(); } catch { /* Already closed. */ }
        finish(new Error("Photo storage could not complete this operation. Your previous draft is preserved."));
      }
    }
  });
}

export async function readPhotoDraft(scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<ScanPhoto[] | null> {
  return (await readPhotoDraftEnvelope(scope, kind))?.photos ?? null;
}

export async function readPhotoDraftEnvelope(scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<PhotoDraftEnvelope | null> {
  const raw = await draftRequest<unknown>("readonly", (store, owner) => store.get(`${owner}:${kind}`), scope);
  if (raw === undefined) return null;
  const draft = normalizePhotoDraft(raw);
  if (!draft) throw new Error("The saved photo draft could not be read safely. It has been kept for recovery.");
  return draft;
}

export function photoGroupsMatch(left: ScanPhoto[], right: ScanPhoto[]) {
  return left.length === right.length && left.every((photo, index) => {
    const other = right[index];
    return photo.id === other.id && photo.label === other.label
      && photo.capturedAt === other.capturedAt && photo.imageBase64 === other.imageBase64;
  });
}

// Photo-only callers may edit only unassigned, unknown-relationship drafts. Read
// the full versioned envelope, then atomically compare that exact observed state;
// photo equality alone never authorizes discarding context or a declaration.
export async function replacePhotoDraftIfMatches(previous: ScanPhoto[] | null, next: ScanPhoto[] | null, scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<boolean> {
  const replacement: ModernPhotoDraftEnvelope | null = next ? { version: 5, photos: next, photoRelationship: "unknown" } : null;
  if (previous === null) return replacePhotoDraftEnvelopeIfMatches(null, replacement, scope, kind);
  const observed = await readPhotoDraftEnvelope(scope, kind);
  if (!observed || (observed.version !== 2 && observed.version !== 5) || observed.target
    || photoRelationshipOrUnknown(observed.photoRelationship) !== "unknown"
    || !validatePhotoGroup(previous) || !photoGroupsMatch(previous, observed.photos)) return false;
  return replacePhotoDraftEnvelopeIfMatches(observed, replacement, scope, kind);
}

// Compare the target as well as the evidence. An old tab cannot relabel, retarget,
// or delete a newer component draft merely because its photo bytes are identical.
export async function replacePhotoDraftEnvelopeIfMatches(previous: PhotoDraftEnvelope | null, next: PhotoDraftEnvelope | null, scope = getAccountScope(), kind: PhotoDraftKind = "upload", mutationGuard?: () => void): Promise<boolean> {
  if ((previous !== null && !normalizePhotoDraft(previous)) || (next !== null && !normalizePhotoDraft(next))) {
    throw new Error("Choose one to four valid, labeled photos and a supported photo relationship. Your previous draft is preserved.");
  }
  const nextWrite = next === null ? null : upgradePhotoDraft(next);
  let matched = false;
  let mutationError: Error | undefined;
  const assertMutation = () => {
    // A Promise cannot authorize a mutation in this transaction's synchronous callback.
    if (mutationGuard?.() !== undefined) throw new Error("Photo draft verification must complete synchronously. The draft was preserved.");
  };
  try { await draftRequest("readwrite", (store, owner) => {
    const key = `${owner}:${kind}`;
    const request = store.get(key);
    request.onsuccess = () => {
      if (!isAccountScopeCurrent(scope)) { store.transaction.abort(); return; }
      const current = normalizePhotoDraft(request.result);
      matched = previous === null ? request.result === undefined : current !== null && photoDraftsMatch(previous, current);
      if (matched) {
        try {
          if (nextWrite === null) {
            if (request.result !== undefined) { assertMutation(); store.delete(key); }
          } else if (previous === null || !photoDraftsMatch(previous, nextWrite)) {
            assertMutation(); store.put(nextWrite, key);
          }
        } catch (error) {
          matched = false;
          mutationError = error instanceof Error ? error : new Error("The saved evidence could not be verified. Its photo draft was preserved.");
          store.transaction.abort();
        }
      }
    };
    return request;
  }, scope); } catch (error) { throw mutationError ?? error; }
  return matched;
}

export function savePhotoDraftIfEmpty(photos: ScanPhoto[], scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<boolean> {
  return replacePhotoDraftIfMatches(null, photos, scope, kind);
}

export function removePhotoDraftIfMatches(photos: ScanPhoto[], scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<boolean> {
  return replacePhotoDraftIfMatches(photos, null, scope, kind);
}
