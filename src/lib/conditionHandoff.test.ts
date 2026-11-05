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

  it("keeps older records without context or an assessment empty", () => {
    expect(formatConditionHandoff(lookup())).toBe("");
  });
});
