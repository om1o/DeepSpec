import { beforeEach, describe, expect, it } from "vitest";
import { createLookup, LOOKUPS_STORAGE_KEY, updateLookup } from "./storage";
import {
  attachScanToJob,
  buildCustomerJobReport,
  buildCustomerVisibleReport,
  createShopJob,
  getShopFeedbackPermission,
  getShopJob,
  getShopJobScans,
  getShopMetrics,
  searchShopJobs,
  setShopLearningOptIn,
} from "./shop";
import type { ScanAnalysisState } from "../types";

const baseJob = {
  make: "Toyota",
  model: "Camry",
  symptom: "Battery light and belt noise.",
  technicianName: "Sam",
  title: "Battery light diagnosis",
  year: "2014",
};

describe("shop service", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("requires complete technician intake before creating a job", () => {
    const result = createShopJob({
      ...baseJob,
      model: "",
      symptom: "",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/vehicle model, symptom\/complaint/i);
  });

  it("creates searchable shop jobs and vehicle context", () => {
    const result = createShopJob({
      ...baseJob,
      bayOrRo: "RO-123",
      customerName: "A. Driver",
      vin: "1hgcm82633a004352",
    });

    expect(result.ok).toBe(true);
    expect(searchShopJobs("RO-123")).toHaveLength(1);
    expect(searchShopJobs("a. driver")).toHaveLength(1);
    expect(result.value).toMatchObject({
      make: "Toyota",
      reviewStatus: "needs_review",
      status: "open",
      vin: "1HGCM82633A004352",
    });
  });

  it("keeps the job's review status in step with its scans after they are rated or corrected", () => {
    const job = createShopJob(baseJob).value!;
    const scan = createLookup(makeScanState({ jobId: job.id, orgId: job.orgId, reviewStatus: "needs_review" })).value;
    attachScanToJob(job.id, scan.id);
    expect(getShopJob(job.id)?.reviewStatus).toBe("needs_review");

    // The status was computed once at attach time and never refreshed afterwards.
    updateLookup(scan.id, { rating: "up" });
    expect(getShopJob(job.id)?.reviewStatus).toBe("confirmed");

    updateLookup(scan.id, { correction: "Serpentine belt tensioner" });
    expect(getShopJob(job.id)?.reviewStatus).toBe("corrected");
  });

  it("keeps a job's stored review status when none of its scans are on this device", () => {
    const job = createShopJob(baseJob).value!;
    // Confirmed at attach time, so "confirmed" is what's stored on the job.
    const scan = createLookup(makeScanState({ jobId: job.id, orgId: job.orgId, reviewStatus: "confirmed" })).value;
    attachScanToJob(job.id, scan.id);
    // Scan evicted from local storage (50-scan cap) or saved on another device: nothing to derive
    // from, so the stored status stands instead of resetting to "needs_review".
    localStorage.setItem(LOOKUPS_STORAGE_KEY, "[]");
    expect(getShopJob(job.id)?.reviewStatus).toBe("confirmed");
  });

  it("describes the scan being saved, not the job's previous scan, in the customer report", () => {
    const job = createShopJob(baseJob).value!;
    const previous = createLookup(makeScanState({ jobId: job.id, orgId: job.orgId })).value; // an Alternator
    attachScanToJob(job.id, previous.id);
    const starter = { ...makeScanState({}).result!, partName: "Starter motor", confidence: "medium" as const };

    const report = buildCustomerVisibleReport(getShopJob(job.id)!, undefined, { result: starter, correction: null });
    expect(report.summary).toContain("Latest DeepSpec result: Starter motor (medium confidence)");
    expect(report.summary).not.toContain("Alternator");

    // A failed scan (no result) is the latest too — it doesn't fall back to the previous part.
    const failed = buildCustomerVisibleReport(getShopJob(job.id)!, undefined, { result: undefined, correction: null });
    expect(failed.summary).toContain("Latest DeepSpec result: part scan (needs review)");
  });

  it("attaches scans, calculates review queues, and respects opt-in learning", () => {
    const job = createShopJob(baseJob).value!;
    const scan = createLookup(makeScanState({
      jobId: job.id,
      orgId: job.orgId,
      reviewStatus: "needs_review",
      vehicleContext: {
        jobTitle: job.title,
        make: job.make,
        model: job.model,
        symptom: job.symptom,
        technicianName: job.technicianName,
        year: job.year,
      },
    })).value;

    attachScanToJob(job.id, scan.id);

    const scans = getShopJobScans(job);
    expect(scans).toHaveLength(1);
    expect(getShopMetrics([job], scans, getShopFeedbackPermission(job.orgId))).toMatchObject({
      correctedScans: 0,
      learnedCorrections: 0,
      needsReviewScans: 1,
      scansTotal: 1,
    });

    setShopLearningOptIn(job.orgId, true);
    const corrected = createLookup(makeScanState({
      jobId: job.id,
      orgId: job.orgId,
      reviewStatus: "corrected",
    })).value;
    attachScanToJob(job.id, corrected.id);
    const nextScans = getShopJobScans(job);

    expect(getShopMetrics([job], nextScans, getShopFeedbackPermission(job.orgId))).toMatchObject({
      correctedScans: 1,
      learnedCorrections: 1,
      scansTotal: 2,
    });
  });

  it("builds customer reports without exact fitment claims", () => {
    const job = createShopJob({
      ...baseJob,
      vin: "",
    }).value!;
    const report = buildCustomerJobReport(job, []);

    expect(report).toContain("VIN: not provided");
    expect(report).toContain("Do not treat this as exact OEM fitment");
  });
});

function makeScanState(overrides: Partial<ScanAnalysisState>): ScanAnalysisState {
  return {
    analyzedAt: "2026-06-18T00:00:05.000Z",
    frame: {
      capturedAt: "2026-06-18T00:00:00.000Z",
      imageBase64: "data:image/jpeg;base64,test",
    },
    result: {
      candidateMatches: [],
      confidence: "high",
      concerns: [],
      evidence: ["Vented housing is visible."],
      evidenceRegions: [],
      fitmentConfidence: "needs_vehicle_context",
      isSafetyCritical: false,
      needsBetterPhoto: false,
      nextAction: "Add VIN before ordering parts.",
      partName: "Alternator",
      requiredNextEvidence: ["VIN"],
      safetyTriage: "can_help",
      scanCategory: "electrical",
      sourceLinks: [],
      visibleObservations: ["Pulley and vented housing."],
      whatItDoes: "Charges the battery while the engine runs.",
    },
    ...overrides,
  };
}
