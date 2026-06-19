import { beforeEach, describe, expect, it } from "vitest";
import { createLookup } from "./storage";
import {
  attachScanToJob,
  buildCustomerJobReport,
  createShopJob,
  getShopFeedbackPermission,
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
