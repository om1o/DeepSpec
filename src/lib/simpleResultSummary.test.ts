import { describe, expect, it } from "vitest";

import { getSimpleResultSummary } from "./simpleResultSummary";
import type { IdentificationResult } from "../types";

function makeResult(partName: string): IdentificationResult {
  return {
    partName,
    confidence: "medium",
    scanCategory: "part",
    candidateMatches: [],
    whatItDoes: "Deep Spec matched the visible item.",
    visibleObservations: ["The item is visible in the photo."],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "normal",
    isSafetyCritical: false,
    nextAction: "",
    needsBetterPhoto: false,
    evidence: [],
    sourceLinks: [],
  };
}

describe("getSimpleResultSummary", () => {
  it("keeps generic scan results identified without saying object detected", () => {
    const summary = getSimpleResultSummary(makeResult("Unknown object"));

    expect(summary.eyebrow).toBe("Identified");
    expect(summary.title).toBe("Item identified");
    expect(summary.title).not.toMatch(/object detected/i);
  });

  it("keeps specific identified labels", () => {
    const summary = getSimpleResultSummary(makeResult("Likely alternator"));

    expect(summary.title).toBe("alternator");
  });
});
