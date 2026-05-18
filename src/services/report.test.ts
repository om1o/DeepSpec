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
    whatItDoes: "It helps squeeze the brake pads against the rotor.",
    visibleObservations: ["Rusty caliper body is visible."],
    concerns: ["Brake parts are safety-critical."],
    safetyTriage: "needs_professional",
    isSafetyCritical: true,
    nextAction: "Verify this with a mechanic before driving.",
    needsBetterPhoto: false,
    evidence: ["Caliper shape near wheel area."],
  },
  analyzedAt: "2026-05-17T12:00:05.000Z",
  rating: "up",
  correction: null,
  notes: "Front driver side.",
  scanCategory: "brakes",
  trainingLabel: "Brake caliper",
  trainingStatus: "user_confirmed",
  chatHistory: [],
};

describe("report", () => {
  it("builds a plain-text scan report", () => {
    const report = buildScanReport(lookup);

    expect(report).toContain("Deep Spec Scan Report");
    expect(report).toContain("Part: Brake caliper");
    expect(report).toContain("Safety triage: needs_professional");
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
