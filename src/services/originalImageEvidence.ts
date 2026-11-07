import { isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { renewableImageReference } from "../lib/visualSelection";
import { CLOUD_SYNC_DISABLED_MESSAGE, isCloudSyncEnabled } from "./cloudSyncPolicy";

export const MAX_ORIGINAL_IMAGE_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
export class OriginalEvidenceError extends Error {
  constructor(public status: "source_changed" | "missing_photo" | "verification_unavailable", message: string) { super(message); }
}
export const unavailableOriginal = () => new OriginalEvidenceError("verification_unavailable", "The original could not be verified. Reopen its saved scan and retry; no substitute image was used.");
export const missingOriginal = () => new OriginalEvidenceError("missing_photo", "This referenced original is unavailable. Its historical reference is retained; another photo was not substituted.");
export const changedOriginal = () => new OriginalEvidenceError("source_changed", "The saved original or its historical context changed. Reopen its saved scan before continuing.");
export function guardOriginalEvidence(scope: AccountScope, signal?: AbortSignal) {
  if (!isAccountScopeCurrent(scope)) throw new OriginalEvidenceError("verification_unavailable", "Account changed. Reopen the saved evidence in its original account.");
  if (signal?.aborted) throw new OriginalEvidenceError("verification_unavailable", "Original-photo verification was canceled.");
}
export async function boundedOriginalEvidenceOperation<T>(scope: AccountScope, signal: AbortSignal | undefined, operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  guardOriginalEvidence(scope, signal); const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => { controller.abort(); reject(new OriginalEvidenceError("verification_unavailable", "Original-photo verification was canceled.")); };
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new OriginalEvidenceError("verification_unavailable", "Original-photo verification timed out. Retry before saving.")); }, TIMEOUT_MS);
    });
    const result = await Promise.race([Promise.resolve(operation(controller.signal)), deadline]); guardOriginalEvidence(scope, signal); return result;
  } finally { clearTimeout(timer); if (cancel) signal?.removeEventListener("abort", cancel); }
}

/** Reference guard only, not proof of bytes or token validity. Non-token options stay significant. */
export function originalImageReference(value: string, lookupId: string, scope: AccountScope): string | null {
  return renewableImageReference(value, { lookupId, scope });
}
type Raster = { data: string; bytes: Uint8Array };
function rasterSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (mime === "image/png") return bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR" && String.fromCharCode(...bytes.slice(-8, -4)) === "IEND";
  return mime === "image/webp" && bytes.length >= 20 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.slice(12, 16))) && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length;
}
function dataRaster(value: string): Raster {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !match[2] || match[2].length % 4 !== 0) throw unavailableOriginal();
  const size = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (size > MAX_ORIGINAL_IMAGE_BYTES) throw new OriginalEvidenceError("verification_unavailable", "This original exceeds the 12 MiB evidence limit. Use a smaller saved original; no partial evidence was saved.");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  if (!rasterSignature(bytes, match[1].toLowerCase())) throw unavailableOriginal();
  return { data: `data:${match[1].toLowerCase()};base64,${match[2]}`, bytes };
}
function base64(bytes: Uint8Array): string {
  let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
async function fetchRaster(url: string, scope: AccountScope, signal?: AbortSignal): Promise<Raster> {
  return boundedOriginalEvidenceOperation(scope, signal, async (requestSignal) => {
    const response = await fetch(url, { signal: requestSignal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
    guardOriginalEvidence(scope, requestSignal);
    if (!response.ok || response.redirected || !response.body) throw unavailableOriginal();
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw unavailableOriginal();
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_ORIGINAL_IMAGE_BYTES) throw unavailableOriginal();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    requestSignal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) { const chunk = await reader.read(); guardOriginalEvidence(scope, requestSignal); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_ORIGINAL_IMAGE_BYTES) throw unavailableOriginal(); chunks.push(chunk.value); }
    } catch (error) { cancel(); throw error; }
    finally { requestSignal.removeEventListener("abort", cancel); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!rasterSignature(bytes, mime)) throw unavailableOriginal();
    return { data: `data:${mime};base64,${base64(bytes)}`, bytes };
  });
}
async function raster(value: string, lookupId: string, scope: AccountScope, signal?: AbortSignal, refresh?: () => Promise<string>): Promise<Raster> {
  if (!value) throw missingOriginal();
  if (value.startsWith("data:")) return dataRaster(value);
  if (!isCloudSyncEnabled()) throw new OriginalEvidenceError("verification_unavailable", CLOUD_SYNC_DISABLED_MESSAGE);
  const reference = originalImageReference(value, lookupId, scope); if (!reference) throw unavailableOriginal();
  try { return await fetchRaster(new URL(value).href, scope, signal); }
  catch (error) {
    guardOriginalEvidence(scope, signal);
    if (!refresh) throw error;
    const refreshed = await refresh(); guardOriginalEvidence(scope, signal);
    if (!originalImageReference(refreshed, lookupId, scope)) throw missingOriginal();
    if (originalImageReference(refreshed, lookupId, scope) !== reference) throw changedOriginal();
    return fetchRaster(new URL(refreshed).href, scope, signal);
  }
}
function dimensions(source: string, signal: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image(); let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true;
      const value = { width: image.naturalWidth, height: image.naturalHeight };
      image.onload = null; image.onerror = null; signal.removeEventListener("abort", abort); image.src = "";
      if (error || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 32768 || value.height > 32768 || value.width * value.height > 100_000_000) reject(error ?? unavailableOriginal()); else resolve(value);
    };
    const abort = () => finish(unavailableOriginal());
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true }); image.onload = () => finish(); image.onerror = () => finish(unavailableOriginal()); image.decoding = "async"; image.src = source;
  });
}

/** The returned raster is the exact file whose bytes and decoded dimensions were inspected. */
export async function inspectOriginalImage(value: string, lookupId: string, scope: AccountScope, signal?: AbortSignal, refresh?: () => Promise<string>): Promise<{ image: string; sha256: string; width: number; height: number }> {
  guardOriginalEvidence(scope, signal);
  const loaded = await raster(value, lookupId, scope, signal, refresh); guardOriginalEvidence(scope, signal);
  const size = await boundedOriginalEvidenceOperation(scope, signal, (requestSignal) => dimensions(loaded.data, requestSignal));
  if (!globalThis.crypto?.subtle) throw unavailableOriginal();
  const hashInput = new Uint8Array(loaded.bytes.byteLength); hashInput.set(loaded.bytes);
  const digest = await boundedOriginalEvidenceOperation(scope, signal, () => crypto.subtle.digest("SHA-256", hashInput.buffer));
  return { ...size, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""), image: loaded.data };
}
