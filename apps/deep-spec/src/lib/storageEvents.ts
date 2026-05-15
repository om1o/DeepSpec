export const STORAGE_COMMIT_EVENT = "deep-spec:storage-commit";

export function emitStorageCommit(): void {
  window.dispatchEvent(new Event(STORAGE_COMMIT_EVENT));
}

export function subscribeStorageCommit(handler: () => void): () => void {
  window.addEventListener(STORAGE_COMMIT_EVENT, handler);
  return () => window.removeEventListener(STORAGE_COMMIT_EVENT, handler);
}
