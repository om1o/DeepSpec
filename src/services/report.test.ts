import { buildScanReport, getMechanicSearchUrl, getScanReportFilename } from "./report";
import type { Lookup } from "../types";
import { emptyPartInspection } from "../lib/partInspection";
import { buildIntakeDraft } from "../lib/intakeDraft";

it("prepares an intake draft without promoting AI confidence, OCR or ratings to verification", () => {
  const draft = buildIntakeDraft({ ...lookup, result: { ...lookup.result!, confidence: "high" } });
  expect(draft.identitySource).toBe("AI suggestion — not verified");
  expect(draft.partNumber).toBe("Not verified");
  expect(draft.functionStatus).toBe("Not tested");
  expect(draft.checks).toContain("Have a qualified professional assess this part before use.");
  expect(buildScanReport(lookup)).toContain("Automatic intake draft\nRecord: lookup-1");
});

it("keeps failed identification and missing observations explicit", () => {
  const failed = { ...lookup, result: undefined };
  expect(buildIntakeDraft(failed).identitySource).toBe("No identification saved");
  expect(buildScanReport(failed)).toContain("Safety: not assessed; no AI result saved.");
  expect(buildScanReport(failed)).not.toContain("Nothing concerning visible");
  expect(buildScanReport(failed)).toContain("Identity status: Identity unresolved");
  expect(buildScanReport(failed)).toContain("Unresolved: AI identification did not complete.");
});

it("asks for another angle and deduplicates requested evidence", () => {
  const draft = buildIntakeDraft({ ...lookup, result: { ...lookup.result!, confirmationNeed: "one_more_angle", requiredNextEvidence: ["Read label", "Read label", " "] } });
  expect(draft.checks).toContain("Take a clearer photo or another angle of the part and its label.");
  expect(draft.checks.filter((check) => check === "Read label")).toHaveLength(1);
});

it.each(["passed", "failed", "inconclusive", "not_tested"] as const)("uses human %s evidence while still requiring fitment verification", (functionalStatus) => {
  const draft = buildIntakeDraft({ ...lookup, inspection: {
    ...emptyPartInspection, inspectorName: "Pat", inspectedAt: "2026-09-20T12:00:00Z",
    confirmedPartName: "Starter", partNumber: "ABC123", identityEvidence: "Stamped label",
    functionalStatus, functionalNotes: "Bench test recorded separately",
  } });
  expect(draft.name).toBe("Starter");
  expect(draft.identitySource).toBe("Human inspection");
  expect(draft.functionStatus).toBe(`${functionalStatus.replaceAll("_", " ")} (human record)`);
  expect(draft.checks).toContain("Verify vehicle fitment against a trusted catalog before ordering or listing.");
  expect(draft.checks).not.toContain("Read and record the part number.");
  if (functionalStatus === "failed") expect(draft.checks).toContain("Functional test failed; resolve the recorded failure before use.");
  if (functionalStatus === "inconclusive") expect(draft.checks).toContain("Functional test was inconclusive; further testing is needed.");
});

it("separates human inspection from AI and never infers function from appearance", () => {
  const report = buildScanReport({ ...lookup, inspection: {
    ...emptyPartInspection, inspectorName: "Pat", inspectedAt: "2026-09-20T12:00:00Z",
    confirmedPartName: "Different part", identityEvidence: "Read stamped number", visibleCondition: "no_visible_damage",
  } });
  expect(report).toContain("AI scan summary:");
  expect(report).toContain("Human inspection (self-reported, separate from AI):");
  expect(report).toContain("Confirmed part: Different part");
  expect(report).toContain("Functional test: not tested");
  expect(buildScanReport(lookup)).toContain("No human inspection recorded. Function not verified.");
});

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
    nextAction: "Check this before driving.",
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
};

describe("report", () => {
  it("builds a plain-text scan report", () => {
    const report = buildScanReport(lookup);

    expect(report).toContain("Deep Spec Scan Report");
    expect(report).toContain("AI scan summary:");
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

  it("dates the filename in the user's local timezone, matching the report body", () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 11:30pm on Sep 17 in New York is already Sep 18 in UTC.
      const evening = { ...lookup, createdAt: "2026-09-18T03:30:00.000Z" };
      expect(getScanReportFilename(evening)).toBe("deep-spec-brake-caliper-2026-09-17.txt");
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("creates a nearby options map URL without ranking shops", () => {
    expect(getMechanicSearchUrl(lookup)).toBe("https://www.google.com/maps/search/brakes%20auto%20repair%20near%20me");
  });
});
