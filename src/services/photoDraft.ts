import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { SCAN_PHOTO_LABELS, type ScanPhoto } from "../types";

const DATABASE = "deep-spec-evidence";
const STORE = "photo-drafts";
export const MAX_INSPECTION_PHOTOS = 4;
export type PhotoDraftKind = "upload" | "capture";

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
  return new Promise<T>((resolve, reject) => {
    let database: IDBDatabase | undefined;
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
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onerror = () => finish(new Error("Photo storage could not be opened. Free device space or allow site storage, then retry."));
    open.onblocked = () => finish(new Error("Another DeepSpec tab is blocking photo storage. Close that tab and retry."));
    open.onsuccess = () => {
      database = open.result;
      if (done) { database.close(); return; }
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
    };
  });
}

export async function readPhotoDraft(scope = getAccountScope(), kind: PhotoDraftKind = "upload"): Promise<ScanPhoto[] | null> {
  const photos = await draftRequest<unknown>("readonly", (store, owner) => store.get(`${owner}:${kind}`), scope);
  if (photos === undefined) return null;
  if (!validatePhotoGroup(photos)) throw new Error("The saved photo draft could not be read safely. It has been kept for recovery.");
  return photos;
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
  if ((previous !== null && !validatePhotoGroup(previous)) || (next !== null && !validatePhotoGroup(next))) {
    throw new Error("Choose one to four valid, labeled photos of the same part or area.");
  }
  let matched = false;
  await draftRequest("readwrite", (store, owner) => {
    const key = `${owner}:${kind}`;
    const request = store.get(key);
    request.onsuccess = () => {
      if (!isAccountScopeCurrent(scope)) { store.transaction.abort(); return; }
      const current = request.result;
      matched = previous === null ? current === undefined : validatePhotoGroup(current) && photoGroupsMatch(previous, current);
      if (matched) {
        if (next === null) {
          if (current !== undefined) store.delete(key);
        } else if (previous === null || !photoGroupsMatch(previous, next)) {
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
