import type { IdentificationResult, ScanCategory } from "../types/index.js";

export const PROFESSIONAL_SAFETY_ACTION = "Have a qualified mechanic inspect this safety-related item before driving or repairing. A photo cannot confirm it is safe to use.";
const PROFESSIONAL_SAFETY_PURPOSE = "An in-person inspection is needed to assess condition and driving safety.";
const SAFETY_CRITICAL_CATEGORIES = new Set<ScanCategory>(["airbag", "brakes", "fuel", "leak", "steering", "suspension"]);

/** Keep model-written procedures out of recommended-action fields, including older saved scans. */
export function withSafeGuidance(result: IdentificationResult): IdentificationResult {
  if (!result.isSafetyCritical && result.safetyTriage !== "needs_professional" && !SAFETY_CRITICAL_CATEGORIES.has(result.scanCategory)) return result;
  return {
    ...result,
    isSafetyCritical: true,
    safetyTriage: "needs_professional",
    nextAction: PROFESSIONAL_SAFETY_ACTION,
    requiredNextEvidence: [PROFESSIONAL_SAFETY_ACTION],
    ...(result.conditionAssessment ? { conditionAssessment: {
      ...result.conditionAssessment,
      nextEvidence: { kind: "professional_inspection" as const, request: PROFESSIONAL_SAFETY_ACTION, purpose: PROFESSIONAL_SAFETY_PURPOSE },
    } } : {}),
    ...(result.photoReview ? { photoReview: {
      ...result.photoReview,
      disagreements: result.photoReview.disagreements.map((item) => ({
        ...item,
        nextEvidence: { request: PROFESSIONAL_SAFETY_ACTION, purpose: PROFESSIONAL_SAFETY_PURPOSE },
      })),
    } } : {}),
  };
}
