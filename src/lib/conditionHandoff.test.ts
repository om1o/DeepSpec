import { describe, expect, it } from "vitest";
import type { Lookup } from "../types";
import { buildConditionHandoff, formatConditionHandoff } from "./conditionHandoff";
import { confirmVehicleContextField } from "./vehicleContext";
import { buildScanReport } from "../services/report";

function lookup(): Lookup {
  return { id: "vehicle-handoff", createdAt: "2026-11-05T12:00:00Z", frame: { capturedAt: "2026-11-05T12:00:00Z", imageBase64: "data:image/png;base64,original" }, scanCategory: "brakes", rating: null, correction: null, notes: "", trainingLabel: "Unknown", trainingStatus: "raw_unreviewed", chatHistory: [], provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: "2026-11-05T12:00:00Z" } };
}

describe("vehicle context in condition handoff", () => {
  it("exports supplied symptoms and vehicle context even when no AI result exists", () => {
    const record = lookup();
    record.vehicleContext = { year: "2014", make: "Subaru", model: "Forester", mileage: "120000", mileageUnit: "km", symptom: "Noise only when cold", modifications: { status: "modified", details: "Aftermarket exhaust" } };
    const text = buildScanReport(record);
    expect(text).toContain("2014 Subaru Forester");
    expect(text).toContain("Symptoms: Noise only when cold");
    expect(text).toContain("Mileage: 120000 km — supplied, unconfirmed");
    expect(text).toContain("Modified: Aftermarket exhaust");
    expect(text.match(/Vehicle details supplied for this scan:/g)).toHaveLength(1);
    expect(text).not.toContain("Condition evidence (AI-reported");
    expect(text).toContain("Safety: not assessed; no AI result saved.");
  });

  it("distinguishes self-reported confirmation from other supplied or unknown fields", () => {
    const record = lookup();
    record.vehicleContext = confirmVehicleContextField({ make: "Toyota", mileage: "120000", vin: "1HGCM82633A004352" }, "make", true, "2026-11-05T12:00:00Z");
    const text = formatConditionHandoff(record);
    expect(text).toContain("Make: Toyota — user-confirmed (self-reported)");
    expect(text).toContain("Mileage: 120000 (unit unknown) — supplied, unconfirmed");
    expect(text).toContain("VIN: 1HGCM82633A004352 — supplied, unconfirmed");
    expect(text).toContain("Modifications: Unknown — not confirmed");
  });

  it("preserves condition references, unknowns and a separate specific safety action", () => {
    const record = lookup(); record.vehicleContext = { symptom: "Pulling under braking" };
    record.result = { partName: "Brake", confidence: "low", scanCategory: "brakes", candidateMatches: [], whatItDoes: "Brakes the vehicle", visibleObservations: [], evidenceRegions: [], concerns: [], safetyTriage: "needs_professional", isSafetyCritical: true, nextAction: "Do not drive until the brake fault is inspected.", needsBetterPhoto: false, evidence: [], sourceLinks: [], conditionAssessment: {
      version: 1, observations: [{ id: "o1", text: "Surface discoloration", photoIds: ["photo-1"] }], possibleCauses: [], unknowns: ["Remaining thickness is unknown."], nextEvidence: { kind: "professional_inspection", request: "Have the rotor measured.", purpose: "Determine remaining thickness." },
    } };
    const text = buildScanReport(record);
    expect(text).toContain("Symptoms: Pulling under braking");
    expect(text).toContain("Original photo [photo-1]");
    expect(text).toContain("Remaining thickness is unknown.");
    expect(text).toContain("Safety action:\nDo not drive until the brake fault is inspected.");
    expect(text.match(/Have the rotor measured\./g)).toHaveLength(1);
    record.result.conditionAssessment!.observations[0].photoIds = ["missing"];
    expect(buildConditionHandoff(record).assessment).toBeUndefined();
    expect(formatConditionHandoff(record)).toContain("Symptoms: Pulling under braking");
    expect(formatConditionHandoff(record)).not.toContain("Surface discoloration");
  });

  it("keeps the missing relationship explicitly unknown without inventing a legacy assessment", () => {
    const text = formatConditionHandoff(lookup());
    expect(text).toBe("Photo relationship: Relationship unknown — a shared part, vehicle or sequence has not been established.");
    expect(text).not.toContain("Condition evidence");
    expect(text).not.toContain("refer to Photo 1");
  });

  it.each([
    ["same_part_or_area", "Same part or area of one car — reported by the user, not independently verified."],
    ["independent", "Independent examples — do not assume the same part, vehicle or before-and-after sequence."],
    [undefined, "Relationship unknown — a shared part, vehicle or sequence has not been established."],
  ] as const)("retains relationship %s in handoff and full text export without an assessment", (photoRelationship, description) => {
    const record = lookup(); record.photoRelationship = photoRelationship;
    record.photos = [{ id: "photo-a", label: "overview", ...record.frame }, { id: "photo-b", label: "other", ...record.frame, imageBase64: "data:image/png;base64,different" }];
    const before = JSON.stringify(record);
    const review = buildConditionHandoff(record), text = formatConditionHandoff(record), full = buildScanReport(record);
    expect(review.photoRelationship).toBe(photoRelationship ?? "unknown");
    expect(review.assessment).toBeUndefined();
    expect(text).toContain(description); expect(full).toContain(description);
    expect(full).not.toContain("Condition evidence (AI-reported");
    expect(full).toContain("Safety: not assessed; no AI result saved.");
    expect(text).toContain("No main identification is recorded.");
    if (photoRelationship !== "same_part_or_area") expect(text).toContain("Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.");
    else expect(text).toContain("User-reported photo relationship:");
    expect(JSON.stringify(record)).toBe(before);
  });

  it.each(["independent", undefined] as const)("scopes supplied car and complaint details to the first original for %s groups", (photoRelationship) => {
    const record = lookup(); record.photoRelationship = photoRelationship;
    record.photos = [{ id: "car-a-overview", label: "overview", ...record.frame }, { id: "separate-car-b", label: "other", ...record.frame, imageBase64: "data:image/png;base64,another-car" }];
    record.vehicleContext = { make: "Toyota", model: "Corolla", symptom: "First car shakes at idle" };
    const before = JSON.stringify(record), review = buildConditionHandoff(record), text = formatConditionHandoff(record);
    expect(review.photoRelationshipScope).toBe("No main identification is recorded. Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.");
    expect(text).toContain("Vehicle and complaint details supplied for Photo 1:");
    expect(text).toContain("Toyota Corolla"); expect(text).toContain("Symptoms: First car shakes at idle");
    expect(text).not.toContain("Vehicle details supplied for this scan:");
    expect(buildScanReport(record)).toContain("Vehicle and complaint details supplied for Photo 1:");
    expect(review.photos.map((photo) => photo.id)).toEqual(["car-a-overview", "separate-car-b"]);
    expect(JSON.stringify(record)).toBe(before);
  });

  it.each([
    ["identify-pipeline-2026-11-05-photo-relationship-v1", "The main identification refers to Photo 1."],
    ["identify-pipeline-2026-11-05-confirmed-vehicle-v1", "The main identification's per-photo scope was not recorded."],
    [undefined, "The main identification's per-photo scope was not recorded."],
  ] as const)("retains actual identity scope provenance in the handoff: %s", (pipelineVersion, expected) => {
    const record = lookup();
    record.photos = [{ id: "first", label: "overview", ...record.frame }, { id: "other", label: "other", ...record.frame }];
    record.result = { partName: "Possible bracket", confidence: "low", scanCategory: "body", candidateMatches: [], whatItDoes: "Unconfirmed", visibleObservations: [], evidenceRegions: [], concerns: [], safetyTriage: "needs_better_photo", isSafetyCritical: false, nextAction: "Verify identity", needsBetterPhoto: true, evidence: [], sourceLinks: [], modelRun: { provider: "gemini", model: "fixture", pipelineVersion, latencyMs: 0, ocrUsed: false } };
    const text = formatConditionHandoff(record);
    expect(text).toContain(expected);
    expect(text).not.toContain("No main identification is recorded.");
    expect(text).toContain("Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.");
    if (pipelineVersion !== "identify-pipeline-2026-11-05-photo-relationship-v1") expect(text).not.toContain("The main identification refers to Photo 1.");
  });
});
