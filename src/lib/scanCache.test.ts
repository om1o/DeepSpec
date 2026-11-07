import { accountStorageKey } from "./accountScope";
import { IDENTIFY_PIPELINE_VERSION } from "../services/systemPrompts";
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
  modelRun: { provider: "gemini", model: "test-model", latencyMs: 10, ocrUsed: false, pipelineVersion: IDENTIFY_PIPELINE_VERSION },
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

  it.each(["unversioned", "other-input", "other-pipeline", "other-result-pipeline"])("ignores a %s cache entry", (kind) => {
    const result = makeResult("Old part");
    const entry = {
      hash: "hash1", result, cachedAt: "2026-11-05T00:00:00Z",
      ...(kind === "unversioned" ? {} : {
        inputVersion: kind === "other-input" ? "multiple-photos-v1" : "single-original-v1",
        pipelineVersion: kind === "other-pipeline" ? "older-pipeline" : IDENTIFY_PIPELINE_VERSION,
      }),
    };
    if (kind === "other-result-pipeline") result.modelRun!.pipelineVersion = "older-pipeline";
    localStorage.setItem(accountStorageKey(SCAN_CACHE_KEY), JSON.stringify([entry]));
    expect(getCachedScanResult("hash1")).toBeNull();
  });
});

describe("setCachedScanResult / getCachedScanResult", () => {
  it.each(["valid", "foreign-photo", "out-of-bounds"])("validates AI areas at cache write and untrusted restore: %s", (kind) => {
    const result: IdentificationResult = { ...makeResult("Brake Caliper"), conditionAssessment: { version: 2,
      observations: [{ id: "edge", text: "A dark line is visible.", photoIds: ["photo-1"], areas: [{
        photoId: kind === "foreign-photo" ? "photo-2" : "photo-1", rectangle: { x: 0.2, y: 0.3, width: kind === "out-of-bounds" ? 1 : 0.2, height: 0.2 },
      }] }], possibleCauses: [], unknowns: [] } };
    const original = structuredClone(result);
    setCachedScanResult("area", result);
    const written = JSON.parse(localStorage.getItem(accountStorageKey(SCAN_CACHE_KEY))!)[0].result;
    if (kind === "valid") expect(written.conditionAssessment).toEqual(result.conditionAssessment);
    else expect(written).not.toHaveProperty("conditionAssessment");
    localStorage.setItem(accountStorageKey(SCAN_CACHE_KEY), JSON.stringify([{ inputVersion: "single-original-v1", pipelineVersion: IDENTIFY_PIPELINE_VERSION,
      hash: "area", result, cachedAt: "2026-11-05T00:00:00Z" }]));
    const restored = getCachedScanResult("area");
    expect(restored?.partName).toBe(result.partName);
    if (kind === "valid") expect(restored?.conditionAssessment).toEqual(result.conditionAssessment);
    else expect(restored).not.toHaveProperty("conditionAssessment");
    expect(result).toEqual(original);
  });

  it("retains a single-original review and the original model run without inventing fresh coverage", () => {
    const result: IdentificationResult = { ...makeResult("Brake Caliper"), photoReview: { version: 1,
      photos: [{ photoId: "photo-1", status: "limited_view", summary: "Only one surface is visible." }], disagreements: [] } };
    result.modelRun!.runId = "original-attempt";
    setCachedScanResult("hash1", result);
    expect(getCachedScanResult("hash1")).toEqual(result);
    setCachedScanResult("hash1", makeResult("Legacy answer without review"));
    expect(getCachedScanResult("hash1")).not.toHaveProperty("photoReview");
  });

  it.each(["photo-2", "saved-custom-id"])("omits review for %s from the single-original cache at write and untrusted restore", (photoId) => {
    const result: IdentificationResult = { ...makeResult("Brake Caliper"), photoReview: { version: 1,
      photos: [{ photoId, status: "observations_returned", summary: "A surface is visible." }], disagreements: [] } };
    setCachedScanResult("hash1", result);
    expect(JSON.parse(localStorage.getItem(accountStorageKey(SCAN_CACHE_KEY))!)[0].result).not.toHaveProperty("photoReview");
    localStorage.setItem(accountStorageKey(SCAN_CACHE_KEY), JSON.stringify([{ inputVersion: "single-original-v1", pipelineVersion: IDENTIFY_PIPELINE_VERSION,
      hash: "hash1", result, cachedAt: "2026-11-05T00:00:00Z" }]));
    expect(getCachedScanResult("hash1")?.partName).toBe("Brake Caliper");
    expect(getCachedScanResult("hash1")).not.toHaveProperty("photoReview");
  });

  it("stores and retrieves a result by hash", () => {
    const result = makeResult("Brake Caliper");
    setCachedScanResult("hash1", result);
    expect(getCachedScanResult("hash1")).toEqual(result);
    expect(JSON.parse(localStorage.getItem(accountStorageKey(SCAN_CACHE_KEY))!)[0]).toMatchObject({
      inputVersion: "single-original-v1", pipelineVersion: IDENTIFY_PIPELINE_VERSION,
    });
  });

  it("overwrites an existing entry for the same hash", () => {
    setCachedScanResult("hash1", makeResult("Old Part"));
    setCachedScanResult("hash1", makeResult("New Part"));
    expect(getCachedScanResult("hash1")?.partName).toBe("New Part");
    const raw = JSON.parse(localStorage.getItem(accountStorageKey(SCAN_CACHE_KEY))!);
    expect(raw).toHaveLength(1);
  });

  it("does not throw when cache persistence is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(() => setCachedScanResult("hash1", makeResult("Brake Caliper"))).not.toThrow();
  });

  it.each([undefined, "older-pipeline"])("does not relabel a result from pipeline %s as current", (pipelineVersion) => {
    const result = makeResult("Old part");
    result.modelRun!.pipelineVersion = pipelineVersion;
    setCachedScanResult("hash1", result);
    expect(localStorage.getItem(accountStorageKey(SCAN_CACHE_KEY))).toBeNull();
  });
});

describe("on-device estimates", () => {
  const withProvider = (partName: string, provider: "on-device" | "gemini"): IdentificationResult => ({
    ...makeResult(partName),
    modelRun: { provider, model: "test-model", latencyMs: 10, ocrUsed: false, pipelineVersion: IDENTIFY_PIPELINE_VERSION },
  });

  it("does not cache an offline estimate, so a rescan gets a real analysis once back online", () => {
    setCachedScanResult("hash1", withProvider("Rough guess", "on-device"));

    expect(getCachedScanResult("hash1")).toBeNull();
    expect(localStorage.getItem(accountStorageKey(SCAN_CACHE_KEY))).toBeNull();
  });

  it("ignores an estimate that an older build already cached", () => {
    localStorage.setItem(
      accountStorageKey(SCAN_CACHE_KEY),
      JSON.stringify([{ hash: "hash1", result: withProvider("Rough guess", "on-device"), cachedAt: "2026-01-01T00:00:00.000Z" }]),
    );

    expect(getCachedScanResult("hash1")).toBeNull();
  });

  it("still caches a full cloud result", () => {
    const result = withProvider("Brake Caliper", "gemini");
    setCachedScanResult("hash1", result);

    expect(getCachedScanResult("hash1")).toEqual(result);
  });

  it("keeps an earlier full result when a later offline estimate arrives for the same photo", () => {
    setCachedScanResult("hash1", withProvider("Brake Caliper", "gemini"));
    setCachedScanResult("hash1", withProvider("Rough guess", "on-device"));

    expect(getCachedScanResult("hash1")?.partName).toBe("Brake Caliper");
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

    const raw = JSON.parse(localStorage.getItem(accountStorageKey(SCAN_CACHE_KEY))!);
    expect(raw).toHaveLength(SCAN_CACHE_MAX);
  });
});

describe("clearScanCache", () => {
  it("removes all entries from localStorage", () => {
    setCachedScanResult("hash1", makeResult("Brake Caliper"));
    setCachedScanResult("hash2", makeResult("Rotor"));
    clearScanCache();
    expect(localStorage.getItem(accountStorageKey(SCAN_CACHE_KEY))).toBeNull();
    expect(getCachedScanResult("hash1")).toBeNull();
  });
});

describe("corrupt localStorage data", () => {
  it("returns null gracefully on parse errors", () => {
    localStorage.setItem(accountStorageKey(SCAN_CACHE_KEY), "not valid json {{{");
    expect(getCachedScanResult("hash1")).toBeNull();
  });

  it("returns null gracefully when stored value is not an array", () => {
    localStorage.setItem(accountStorageKey(SCAN_CACHE_KEY), JSON.stringify({ hash: "hash1" }));
    expect(getCachedScanResult("hash1")).toBeNull();
  });
});

describe("hashImageDataUrl", () => {
  it("returns null for malformed base64 instead of throwing", async () => {
    await expect(hashImageDataUrl("data:image/jpeg;base64,not valid base64!")).resolves.toBeNull();
  });
});
