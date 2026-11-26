import { describe, expect, it } from "vitest";
import type { IdentificationResult } from "../types";
import { PROFESSIONAL_SAFETY_ACTION, withSafeGuidance } from "./safetyGuidance";

const result: IdentificationResult = {
  partName: "Brake line",
  confidence: "medium",
  scanCategory: "brakes",
  candidateMatches: [],
  whatItDoes: "Carries brake fluid.",
  visibleObservations: [],
  evidenceRegions: [],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Keep driving until the warning clears before driving.",
  requiredNextEvidence: ["Keep driving to check the warning."],
  conditionAssessment: {
    version: 1,
    observations: [],
    possibleCauses: [],
    unknowns: [],
    nextEvidence: { kind: "photo", request: "Keep driving to check the leak.", purpose: "Check safety while moving." },
  },
  photoReview: {
    version: 1,
    photos: [],
    disagreements: [{ id: "d1", photoIds: ["photo-1"], description: "Views disagree.", nextEvidence: { request: "Keep driving.", purpose: "See what happens." } }],
  },
  needsBetterPhoto: false,
  evidence: [],
  sourceLinks: [],
};

describe("withSafeGuidance", () => {
  it("replaces every recommended action for a safety-critical category without changing saved evidence", () => {
    const before = JSON.stringify(result);
    const safe = withSafeGuidance(result);
    expect(safe).toMatchObject({
      safetyTriage: "needs_professional",
      isSafetyCritical: true,
      nextAction: PROFESSIONAL_SAFETY_ACTION,
      requiredNextEvidence: [PROFESSIONAL_SAFETY_ACTION],
      conditionAssessment: { nextEvidence: { kind: "professional_inspection", request: PROFESSIONAL_SAFETY_ACTION } },
      photoReview: { disagreements: [{ nextEvidence: { request: PROFESSIONAL_SAFETY_ACTION } }] },
    });
    expect(JSON.stringify(safe)).not.toContain("Keep driving");
    expect(JSON.stringify(result)).toBe(before);
  });

  it("leaves a noncritical observational check intact", () => {
    const ordinary = { ...result, scanCategory: "electrical" as const, nextAction: "Photograph the label." };
    expect(withSafeGuidance(ordinary)).toBe(ordinary);
  });
});
