import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCAN_CACHE_KEY,
  SCAN_CACHE_MAX,
  clearScanCache,
  getCachedScanResult,
  hashImageDataUrl,
  setCachedScanResult,
} from "./scanCache";
import type { IdentificationResult } from "../types/index";

const makeResult = (partName: string): IdentificationResult => ({
  partName,
  confidence: "high",
  scanCategory: "brakes",
  candidateMatches: [],
  whatItDoes: "Stops the car",
  visibleObservations: [],
  evidenceRegions: [],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: true,
  nextAction: "Inspect pads",
  needsBetterPhoto: false,
  evidence: [],
  sourceLinks: [],
});

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("getCachedScanResult", () => {
  it("returns null when localStorage is empty", () => {
    expect(getCachedScanResult("abc123")).toBeNull();
  });

  it("returns null for an unknown hash", () => {
    setCachedScanResult("known", makeResult("Brake Caliper"));
    expect(getCachedScanResult("unknown")).toBeNull();
  });
});

describe("setCachedScanResult / getCachedScanResult", () => {
  it("stores and retrieves a result by hash", () => {
    const result = makeResult("Brake Caliper");
    setCachedScanResult("hash1", result);
    expect(getCachedScanResult("hash1")).toEqual(result);
  });

  it("overwrites an existing entry for the same hash", () => {
    setCachedScanResult("hash1", makeResult("Old Part"));
    setCachedScanResult("hash1", makeResult("New Part"));
    expect(getCachedScanResult("hash1")?.partName).toBe("New Part");
    const raw = JSON.parse(localStorage.getItem(SCAN_CACHE_KEY)!);
    expect(raw).toHaveLength(1);
  });

  it("does not throw when cache persistence is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(() => setCachedScanResult("hash1", makeResult("Brake Caliper"))).not.toThrow();
  });
});

describe("capacity eviction", () => {
  it("evicts the oldest entry when cap is reached", () => {
    for (let i = 0; i < SCAN_CACHE_MAX; i++) {
      setCachedScanResult(`hash${i}`, makeResult(`Part ${i}`));
    }
    setCachedScanResult("hashNew", makeResult("New Part"));

    expect(getCachedScanResult("hash0")).toBeNull();
    expect(getCachedScanResult("hashNew")).not.toBeNull();

    const raw = JSON.parse(localStorage.getItem(SCAN_CACHE_KEY)!);
    expect(raw).toHaveLength(SCAN_CACHE_MAX);
  });
});

describe("clearScanCache", () => {
  it("removes all entries from localStorage", () => {
    setCachedScanResult("hash1", makeResult("Brake Caliper"));
    setCachedScanResult("hash2", makeResult("Rotor"));
    clearScanCache();
    expect(localStorage.getItem(SCAN_CACHE_KEY)).toBeNull();
    expect(getCachedScanResult("hash1")).toBeNull();
  });
});

describe("corrupt localStorage data", () => {
  it("returns null gracefully on parse errors", () => {
    localStorage.setItem(SCAN_CACHE_KEY, "not valid json {{{");
    expect(getCachedScanResult("hash1")).toBeNull();
  });

  it("returns null gracefully when stored value is not an array", () => {
    localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify({ hash: "hash1" }));
    expect(getCachedScanResult("hash1")).toBeNull();
  });
});

describe("hashImageDataUrl", () => {
  it("returns null for malformed base64 instead of throwing", async () => {
    await expect(hashImageDataUrl("data:image/jpeg;base64,not valid base64!")).resolves.toBeNull();
  });
});
