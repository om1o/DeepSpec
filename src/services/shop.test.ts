import { accountStorageKey, getAccountScope, setActiveAccount } from "../lib/accountScope";
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
  getVehicleContextForJob,
  searchShopJobs,
  setShopLearningOptIn,
  updateShopJob,
  readShopJob,
  subscribeShopJobs,
  SHOP_JOBS_STORAGE_KEY,
} from "./shop";
import type { ScanAnalysisState } from "../types";
import { confirmVehicleContextField, isVehicleFieldConfirmed } from "../lib/vehicleContext";
import { referenceVehicleContext } from "../test/vehicleReferenceFixture";

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

  it("keeps source snapshots through job creation, reopen and scan context, pruning only changed fields", () => {
    const context = referenceVehicleContext();
    const created = createShopJob({ ...baseJob, ...context });
    if (!created.ok) throw new Error(created.message);
    if (!created.value) throw new Error("No job was created");
    expect(getShopJob(created.value.id)?.referenceOrigins).toEqual(context.referenceOrigins);
    expect(getVehicleContextForJob(created.value).referenceOrigins).toEqual(context.referenceOrigins);
    const updated = updateShopJob(created.value.id, { make: "Other" });
    expect(updated.value?.referenceOrigins?.fields).toEqual({ year: context.referenceOrigins.fields.year });
    expect(updateShopJob(created.value.id, { referenceOrigins: undefined }).value?.referenceOrigins).toBeUndefined();
    expect(created.value.referenceOrigins).toEqual(context.referenceOrigins);
  });

  it("distinguishes an absent job from unreadable owner storage without creating an organization", () => {
    expect(readShopJob("missing")).toEqual({ ok: true, value: null }); expect(localStorage.length).toBe(0);
    const key = accountStorageKey(SHOP_JOBS_STORAGE_KEY);
    for (const raw of ["{broken", "{}", JSON.stringify([{ id: "bad", scanIds: [] }])]) {
      localStorage.setItem(key, raw); expect(readShopJob("missing")).toMatchObject({ ok: false, value: null }); expect(localStorage.getItem(key)).toBe(raw);
    }
  });
  it("rejects duplicate job identities and non-string scan references rather than normalizing them away", () => {
    const job = createShopJob(baseJob).value!; const key = accountStorageKey(SHOP_JOBS_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify([job, job])); expect(readShopJob(job.id).ok).toBe(false);
    localStorage.setItem(key, JSON.stringify([{ ...job, scanIds: [123] }])); expect(readShopJob(job.id).ok).toBe(false);
  });
  it("reads only the current account and rejects an old generation after switching back", () => {
    const scope = getAccountScope(); const job = createShopJob(baseJob).value!;
    expect(readShopJob(job.id, scope)).toMatchObject({ ok: true, value: { id: job.id } });
    setActiveAccount("different-shop-owner"); expect(readShopJob(job.id, scope).ok).toBe(false); expect(readShopJob(job.id)).toEqual({ ok: true, value: null });
    setActiveAccount(scope.userId); expect(readShopJob(job.id, scope).ok).toBe(false); expect(readShopJob(job.id).ok).toBe(true);
  });
  it("notifies successful job writes only for the captured owner and stops after unsubscribe", () => {
    const job = createShopJob(baseJob).value!; const scope = getAccountScope(); const listener = vi.fn(); const stop = subscribeShopJobs(listener, scope);
    updateShopJob(job.id, { notes: "Saved change" }); expect(listener).toHaveBeenCalledTimes(1);
    const ownKey = accountStorageKey(SHOP_JOBS_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: ownKey, storageArea: localStorage })); expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "another-key", storageArea: localStorage })); expect(listener).toHaveBeenCalledTimes(2);
    const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("Full"); });
    expect(updateShopJob(job.id, { notes: "Unsaved" }).ok).toBe(false); expect(listener).toHaveBeenCalledTimes(2); failure.mockRestore();
    setActiveAccount("different-shop-owner"); window.dispatchEvent(new StorageEvent("storage", { key: ownKey, storageArea: localStorage })); expect(listener).toHaveBeenCalledTimes(2);
    setActiveAccount(scope.userId); updateShopJob(job.id, { notes: "New generation" }); expect(listener).toHaveBeenCalledTimes(2);
    stop(); updateShopJob(job.id, { notes: "After cleanup" }); expect(listener).toHaveBeenCalledTimes(2);
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
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), "[]");
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

  it("round trips units, modifications and value-bound confirmations in local shop records", () => {
    let context = confirmVehicleContextField({ ...baseJob, mileage: "120000", mileageUnit: "km", modifications: { status: "modified", details: "Replacement engine" }, vin: "1hgcm82633a004352" }, "mileage", true);
    context = confirmVehicleContextField(context, "modifications", true);
    context = confirmVehicleContextField(context, "vin", true);
    const result = createShopJob({ ...baseJob, ...context, make: baseJob.make, model: baseJob.model, year: baseJob.year, symptom: baseJob.symptom, technicianName: baseJob.technicianName, bayOrRo: "RO-9" });
    expect(result.ok).toBe(true);
    const reopened = getShopJob(result.value!.id)!;
    const scanContext = getVehicleContextForJob(reopened);
    expect(scanContext).toMatchObject({ mileage: "120000", mileageUnit: "km", modifications: { status: "modified", details: "Replacement engine" }, bayOrRo: "RO-9", vin: "1HGCM82633A004352" });
    expect(isVehicleFieldConfirmed(scanContext, "mileage")).toBe(true);
    expect(isVehicleFieldConfirmed(scanContext, "modifications")).toBe(true);
    expect(isVehicleFieldConfirmed(scanContext, "vin")).toBe(true);
    expect(isVehicleFieldConfirmed(scanContext, "year")).toBe(false);
    const report = buildCustomerJobReport(reopened, []);
    expect(report).toContain("Mileage: 120000 km — user-confirmed (self-reported)");
    expect(report).toContain("Modified: Replacement engine — user-confirmed (self-reported)");
    expect(report).toContain(`Symptoms: ${baseJob.symptom}`);
    expect(report).toContain("Year: 2014 — supplied, unconfirmed");
    expect(report.match(/VIN:/g)).toHaveLength(1);
  });

  it("drops stale mileage or modification confirmation when a job field changes", () => {
    let context = confirmVehicleContextField({ ...baseJob, mileage: "80000", mileageUnit: "mi", modifications: { status: "none_known" } }, "mileage", true);
    context = confirmVehicleContextField(context, "modifications", true);
    const job = createShopJob({ ...context, ...baseJob }).value!;
    const changedUnits = updateShopJob(job.id, { mileageUnit: "km" }).value!;
    expect(isVehicleFieldConfirmed(changedUnits, "mileage")).toBe(false);
    expect(isVehicleFieldConfirmed(changedUnits, "modifications")).toBe(true);
    const changedModifications = updateShopJob(job.id, { modifications: { status: "modified", details: "Changed intake" } }).value!;
    expect(isVehicleFieldConfirmed(changedModifications, "modifications")).toBe(false);
  });

  it("preserves legacy intake without promoting a VIN or freeform mileage to confirmation", () => {
    const job = createShopJob({ ...baseJob, mileage: "120000 miles", vin: "1HGCM82633A004352", notes: "Owner notes", symptom: "A".repeat(450) }).value!;
    const context = getVehicleContextForJob(getShopJob(job.id)!);
    expect(context).toMatchObject({ mileage: "120000 miles", notes: "Owner notes", symptom: "A".repeat(450) });
    expect(context.mileageUnit).toBeUndefined();
    expect(context.confirmedFields).toBeUndefined();
    const report = buildCustomerJobReport(job, []);
    expect(report).toContain("(unit unknown)");
    expect(report).toContain("Modifications: Unknown — not confirmed");
    expect(report).toContain("VIN: 1HGCM82633A004352 — supplied, unconfirmed");
    expect(report).toContain("A".repeat(450));
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
