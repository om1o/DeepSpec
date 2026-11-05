import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { SCAN_PHOTO_LABELS, type ScanPhoto } from "../types";
import type { ComponentCaptureTarget } from "../types/componentMap";
import { normalizeComponentCaptureTarget } from "../lib/componentMap";
import { openEvidenceDatabase } from "./evidenceDb";

const STORE = "photo-drafts";
export const MAX_INSPECTION_PHOTOS = 4;
export type PhotoDraftKind = "upload" | "capture";
export type PhotoDraftEnvelope = { version: 2; photos: ScanPhoto[]; target?: ComponentCaptureTarget };

export function normalizePhotoDraft(value: unknown): PhotoDraftEnvelope | null {
  if (validatePhotoGroup(value)) return { version: 2, photos: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Partial<PhotoDraftEnvelope>;
  if (draft.version !== 2 || !validatePhotoGroup(draft.photos)) return null;
  const target = draft.target === undefined ? undefined : normalizeComponentCaptureTarget(draft.target);
  return target === null ? null : { version: 2, photos: draft.photos, ...(target ? { target } : {}) };
}

export function componentCaptureTargetsMatch(left?: ComponentCaptureTarget, right?: ComponentCaptureTarget): boolean {
  if (!left || !right) return left === right;
  return left.mapId === right.mapId && left.componentId === right.componentId
    && left.linkAttemptId === right.linkAttemptId && left.lookupId === right.lookupId;
}

export function photoDraftsMatch(left: PhotoDraftEnvelope, right: PhotoDraftEnvelope): boolean {
  return componentCaptureTargetsMatch(left.target, right.target) && photoGroupsMatch(left.photos, right.photos);
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

// Compare the exact reviewed group and mutate in one transaction. Passing the same
// group as previous/next verifies durability without rewriting another tab's work.
export async function replacePhotoDraftIfMatches(previous: ScanPhoto[] | null, next: ScanPhoto[] | null, scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<boolean> {
  return replacePhotoDraftEnvelopeIfMatches(previous ? { version: 2, photos: previous } : null, next ? { version: 2, photos: next } : null, scope, kind);
}

// Compare the target as well as the evidence. An old tab cannot relabel, retarget,
// or delete a newer component draft merely because its photo bytes are identical.
export async function replacePhotoDraftEnvelopeIfMatches(previous: PhotoDraftEnvelope | null, next: PhotoDraftEnvelope | null, scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<boolean> {
  if ((previous !== null && !normalizePhotoDraft(previous)) || (next !== null && !normalizePhotoDraft(next))) {
    throw new Error("Choose one to four valid, labeled photos of the same part or area.");
  }
  let matched = false;
  await draftRequest("readwrite", (store, owner) => {
    const key = `${owner}:${kind}`;
    const request = store.get(key);
    request.onsuccess = () => {
      if (!isAccountScopeCurrent(scope)) { store.transaction.abort(); return; }
      const current = normalizePhotoDraft(request.result);
      matched = previous === null ? request.result === undefined : current !== null && photoDraftsMatch(previous, current);
      if (matched) {
        if (next === null) {
          if (request.result !== undefined) store.delete(key);
        } else if (previous === null || !photoDraftsMatch(previous, next)) {
          store.put(next, key);
        }
      }
    };
    return request;
  }, scope);
  return matched;
}

export function savePhotoDraftIfEmpty(photos: ScanPhoto[], scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<boolean> {
  return replacePhotoDraftIfMatches(null, photos, scope, kind);
}

export function removePhotoDraftIfMatches(photos: ScanPhoto[], scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<boolean> {
  return replacePhotoDraftIfMatches(photos, null, scope, kind);
}
