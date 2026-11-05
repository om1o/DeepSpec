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

  it("keeps an uncertain identification qualified in the heading", () => {
    const summary = getSimpleResultSummary(makeResult("Likely alternator"));

    expect(summary.title).toBe("Likely alternator");
  });

  it("does not promote a hypothetical concern into a visible issue", () => {
    const result = makeResult("Bracket");
    result.concerns = ["Hidden corrosion could weaken the mounting."];
    expect(getSimpleResultSummary(result)).toMatchObject({ eyebrow: "Best match", body: result.whatItDoes });
  });

  it("describes the visible surface evidence without replacing it with a possible cause", () => {
    const result = makeResult("Brake rotor");
    result.visibleObservations = ["Surface rust is visible on the outer edge."];
    result.concerns = ["Possible structural weakening from corrosion."];
    expect(getSimpleResultSummary(result)).toMatchObject({ eyebrow: "Visible issue", body: result.visibleObservations[0] });
  });

  it("retains the entire specific safety action even when no better photo is needed", () => {
    const result = makeResult("Brake mounting bracket");
    result.isSafetyCritical = true;
    result.safetyTriage = "needs_professional";
    result.nextAction = "Do not drive until the mounting bracket has been checked. A qualified technician should inspect the apparent crack and the mounting points before deciding whether the assembly can be reused.";
    expect(getSimpleResultSummary(result).nextAction).toBe(result.nextAction);
  });
});
