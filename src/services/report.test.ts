import { buildScanReport, getMechanicSearchUrl, getScanReportFilename } from "./report";
import type { Lookup } from "../types";

const lookup: Lookup = {
  id: "lookup-1",
  createdAt: "2026-05-17T12:00:00.000Z",
  frame: {
    imageBase64: "data:image/jpeg;base64,test",
    capturedAt: "2026-05-17T12:00:00.000Z",
  },
  result: {
    partName: "Brake caliper",
    confidence: "medium",
    scanCategory: "brakes",
    candidateMatches: [
      {
        partName: "Brake rotor",
        confidence: "low",
        scanCategory: "brakes",
        reason: "Nearby wheel-well part, but caliper body is more visible.",
      },
    ],
    whatItDoes: "It helps squeeze the brake pads against the rotor.",
    visibleObservations: ["Rusty caliper body is visible."],
    evidenceRegions: [
      {
        label: "Caliper body",
        observation: "Rusty caliper body is visible near the wheel area.",
        regionLabel: "Scanned area",
      },
    ],
    concerns: ["Brake parts are safety-critical."],
    safetyTriage: "needs_professional",
    isSafetyCritical: true,
    nextAction: "Verify this with a mechanic before driving.",
    needsBetterPhoto: false,
    evidence: [
      "Caliper shape near wheel area.",
      "OCR label text: ATE 60-12345",
      "Local dataset match: Brake caliper (part, 4 labeled samples)",
      "Dataset source: https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/sample.jpg",
    ],
    sourceLinks: [
      {
        label: "Dataset sample: Brake caliper",
        url: "https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/sample.jpg",
        sourceType: "dataset",
      },
    ],
  },
  analyzedAt: "2026-05-17T12:00:05.000Z",
  rating: "up",
  correction: null,
  notes: "Front driver side.",
  scanCategory: "brakes",
  trainingLabel: "Brake caliper",
  trainingStatus: "user_confirmed",
  chatHistory: [],
  modelRuns: [],
  syncEvents: [],
};

describe("report", () => {
  it("builds a plain-text scan report", () => {
    const report = buildScanReport(lookup);

    expect(report).toContain("Deep Spec Scan Report");
    expect(report).toContain("Mechanic summary:");
    expect(report).toContain("Part: Brake caliper");
    expect(report).toContain("Safety triage: needs_professional");
    expect(report).toContain("Other possible matches:");
    expect(report).toContain("Brake rotor (low): Nearby wheel-well part");
    expect(report).toContain("Image evidence:");
    expect(report).toContain("Scanned area: Caliper body");
    expect(report).toContain("Detected text:");
    expect(report).toContain("ATE 60-12345");
    expect(report).toContain("Ranked sources:");
    expect(report).toContain("Dataset sample: Brake caliper (dataset)");
    expect(report).toContain("Local dataset match: Brake caliper");
    expect(report).toContain("Dataset source: https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset");
    expect(report).toContain("Front driver side.");
    expect(report).toContain("not a repair certification tool");
  });

  it("creates safe report filenames", () => {
    expect(getScanReportFilename(lookup)).toBe("deep-spec-brake-caliper-2026-05-17.txt");
  });

  it("creates a nearby options map URL without ranking shops", () => {
    expect(getMechanicSearchUrl(lookup)).toBe("https://www.google.com/maps/search/brakes%20auto%20repair%20near%20me");
  });
});
