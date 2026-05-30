import type { IdentificationResult } from "../types/index";

export const SCAN_CACHE_KEY = "deep-spec:scan-cache";
export const SCAN_CACHE_MAX = 20;

type CacheEntry = {
  hash: string;
  result: IdentificationResult;
  cachedAt: string;
};

export async function hashImageDataUrl(dataUrl: string): Promise<string | null> {
  if (!crypto?.subtle) return null;

  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

function loadCache(): CacheEntry[] {
  try {
    const raw = localStorage.getItem(SCAN_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CacheEntry[];
  } catch {
    return [];
  }
}

function saveCache(entries: CacheEntry[]): void {
  try {
    localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify(entries));
  } catch {
    // Scan caching is best-effort and must not break identification.
  }
}

export function getCachedScanResult(hash: string): IdentificationResult | null {
  const entries = loadCache();
  const entry = entries.find((e) => e.hash === hash);
  return entry?.result ?? null;
}

export function setCachedScanResult(hash: string, result: IdentificationResult): void {
  const entries = loadCache().filter((e) => e.hash !== hash);
  entries.push({ hash, result, cachedAt: new Date().toISOString() });
  if (entries.length > SCAN_CACHE_MAX) {
    entries.splice(0, entries.length - SCAN_CACHE_MAX);
  }
  saveCache(entries);
}

export function clearScanCache(): void {
  try {
    localStorage.removeItem(SCAN_CACHE_KEY);
  } catch {
    // Ignore cache cleanup failures.
  }
}
