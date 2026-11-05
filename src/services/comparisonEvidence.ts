import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { comparisonSideMatches, normalizeComparisonSide, normalizeComparisonTimestamp } from "../lib/inspectionComparison";
import { providerVehicleContext } from "../lib/vehicleContext";
import { photoRelationshipOrUnknown } from "../lib/photoRelationship";
import type { Lookup, ScanPhoto } from "../types";
import type { ComparisonSide } from "../types/inspectionComparison";
import { readCloudLookupForReport } from "./cloudHistory";
import { CLOUD_SYNC_DISABLED_MESSAGE, isCloudSyncEnabled } from "./cloudSyncPolicy";
import { getLookup, readLookups } from "./storage";

export const MAX_COMPARISON_IMAGE_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
export type ComparisonResolution = { status: "unchanged" | "source_changed" | "missing_photo" | "verification_unavailable"; image?: string; message: string };
class EvidenceError extends Error {
  constructor(public status: Exclude<ComparisonResolution["status"], "unchanged">, message: string) { super(message); }
}
const unavailable = () => new EvidenceError("verification_unavailable", "The original could not be verified. Reopen its saved scan and retry; no substitute image was used.");
const missing = () => new EvidenceError("missing_photo", "This referenced original is unavailable. Its historical reference is retained; another photo was not substituted.");
const changed = () => new EvidenceError("source_changed", "The saved original or its historical context changed. Review the saved comparison before creating a new record.");
function guard(scope: AccountScope, signal?: AbortSignal) {
  if (!isAccountScopeCurrent(scope)) throw new EvidenceError("verification_unavailable", "Account changed. Reopen the comparison in its original account.");
  if (signal?.aborted) throw new EvidenceError("verification_unavailable", "Original-photo verification was canceled.");
}
async function bounded<T>(scope: AccountScope, signal: AbortSignal | undefined, operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  guard(scope, signal); const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => { controller.abort(); reject(new EvidenceError("verification_unavailable", "Original-photo verification was canceled.")); };
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new EvidenceError("verification_unavailable", "Original-photo verification timed out. Retry before saving a comparison.")); }, TIMEOUT_MS);
    });
    const result = await Promise.race([Promise.resolve(operation(controller.signal)), deadline]); guard(scope, signal); return result;
  } finally { clearTimeout(timer); if (cancel) signal?.removeEventListener("abort", cancel); }
}

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
function ownedUrl(value: string, lookupId: string, scope: AccountScope): URL | null {
  try {
    const base = new URL(import.meta.env.VITE_SUPABASE_URL ?? ""), url = new URL(value);
    const prefix = "/storage/v1/object/sign/scan-images/";
    if (base.protocol !== "https:" || base.username || base.password || url.protocol !== "https:" || url.origin !== base.origin || url.username || url.password || url.hash
      || !url.pathname.startsWith(prefix) || !url.searchParams.get("token")) return null;
    const parts = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent);
    if (parts.length < 3 || parts[0] !== scope.userId || parts[1] !== lookupId || parts.some((part) => !part || part === "." || part === ".." || /[\\/%]/.test(part))) return null;
    return url;
  } catch { return null; }
}
function signature(lookup: Lookup | null, photoId: string, scope: AccountScope): string {
  if (!lookup) return "absent";
  const photo = original(lookup, photoId), url = ownedUrl(photo.imageBase64, lookup.id, scope);
  return JSON.stringify({ ...metadata(lookup, photo), image: url ? `${url.origin}${url.pathname}` : photo.imageBase64 });
}
async function cloudLookup(id: string, scope: AccountScope, signal?: AbortSignal): Promise<Lookup | null> {
  if (!isCloudSyncEnabled()) throw new EvidenceError("verification_unavailable", CLOUD_SYNC_DISABLED_MESSAGE);
  const response = await bounded(scope, signal, () => readCloudLookupForReport(id));
  if (!response.ok) throw unavailable();
  if (response.value && response.value.id !== id) throw unavailable();
  return response.value ? structuredClone(response.value) : null;
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
  if (!match || !match[2] || match[2].length % 4 !== 0) throw unavailable();
  const size = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (size > MAX_COMPARISON_IMAGE_BYTES) throw new EvidenceError("verification_unavailable", "This original exceeds the 12 MiB comparison limit. Use a smaller saved original; no partial comparison was saved.");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  if (!rasterSignature(bytes, match[1].toLowerCase())) throw unavailable();
  return { data: `data:${match[1].toLowerCase()};base64,${match[2]}`, bytes };
}
function base64(bytes: Uint8Array): string {
  let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
async function fetchRaster(url: string, scope: AccountScope, signal?: AbortSignal): Promise<Raster> {
  return bounded(scope, signal, async (requestSignal) => {
    const response = await fetch(url, { signal: requestSignal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
    guard(scope, requestSignal);
    if (!response.ok || response.redirected || !response.body) throw unavailable();
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw unavailable();
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_COMPARISON_IMAGE_BYTES) throw unavailable();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    requestSignal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) { const chunk = await reader.read(); guard(scope, requestSignal); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_COMPARISON_IMAGE_BYTES) throw unavailable(); chunks.push(chunk.value); }
    } catch (error) { cancel(); throw error; }
    finally { requestSignal.removeEventListener("abort", cancel); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!rasterSignature(bytes, mime)) throw unavailable();
    return { data: `data:${mime};base64,${base64(bytes)}`, bytes };
  });
}
async function raster(lookup: Lookup, photo: ScanPhoto, scope: AccountScope, signal?: AbortSignal): Promise<Raster> {
  if (!photo.imageBase64) throw missing();
  if (photo.imageBase64.startsWith("data:")) return dataRaster(photo.imageBase64);
  if (!isCloudSyncEnabled()) throw new EvidenceError("verification_unavailable", CLOUD_SYNC_DISABLED_MESSAGE);
  const url = ownedUrl(photo.imageBase64, lookup.id, scope); if (!url) throw unavailable();
  try { return await fetchRaster(url.href, scope, signal); }
  catch {
    guard(scope, signal);
    const remote = await cloudLookup(lookup.id, scope, signal); if (!remote) throw missing();
    const refreshed = original(remote, photo.id);
    const refreshedAt = normalizeComparisonTimestamp(refreshed.capturedAt), originalAt = normalizeComparisonTimestamp(photo.capturedAt);
    if (!refreshedAt || !originalAt || refreshedAt !== originalAt || refreshed.label !== photo.label) throw changed();
    const fresh = ownedUrl(refreshed.imageBase64, lookup.id, scope);
    if (!fresh) throw missing();
    if (fresh.pathname !== url.pathname || fresh.origin !== url.origin) throw changed();
    return fetchRaster(fresh.href, scope, signal);
  }
}
function dimensions(source: string, signal: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image(); let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true;
      const value = { width: image.naturalWidth, height: image.naturalHeight };
      image.onload = null; image.onerror = null; signal.removeEventListener("abort", abort); image.src = "";
      if (error || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 32768 || value.height > 32768 || value.width * value.height > 100_000_000) reject(error ?? unavailable()); else resolve(value);
    };
    const abort = () => finish(unavailable());
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true }); image.onload = () => finish(); image.onerror = () => finish(unavailable()); image.decoding = "async"; image.src = source;
  });
}
async function inspect(lookup: Lookup, photoId: string, scope: AccountScope, signal?: AbortSignal) {
  guard(scope, signal); const photo = original(lookup, photoId);
  const loaded = await raster(lookup, photo, scope, signal); guard(scope, signal);
  const size = await bounded(scope, signal, (requestSignal) => dimensions(loaded.data, requestSignal));
  if (!globalThis.crypto?.subtle) throw unavailable();
  const hashInput = new Uint8Array(loaded.bytes.byteLength); hashInput.set(loaded.bytes);
  const digest = await bounded(scope, signal, () => crypto.subtle.digest("SHA-256", hashInput.buffer));
  const side = normalizeComparisonSide({ ...metadata(lookup, photo), ...size, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""), observedOn: null });
  if (!side) throw unavailable();
  return { side, image: loaded.data };
}

/** Inspect only the chosen saved original; the caller owns saved-record race checks. */
export async function comparisonSideForLookup(lookup: Lookup, photoId: string, scope = getAccountScope()): Promise<ComparisonSide> {
  guard(scope);
  try { return (await inspect(structuredClone(lookup), photoId, scope)).side; }
  catch (error) { guard(scope); throw error instanceof EvidenceError ? error : unavailable(); }
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
