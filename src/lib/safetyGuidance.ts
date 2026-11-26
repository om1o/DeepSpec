import type { IdentificationResult, ScanCategory } from "../types/index.js";

export const PROFESSIONAL_SAFETY_ACTION = "Have a qualified mechanic inspect this safety-related item before driving or repairing. A photo cannot confirm it is safe to use.";
export const UNVERIFIED_FITMENT_BOUNDARY = "Exact replacement fitment is unverified. Confirm the vehicle VIN and build/options, then check the exact part number in an authorized OEM or licensed parts catalog before ordering. A photo, VIN decode, or visible label alone cannot establish compatibility. This answer addresses fitment only.";
export const SAFETY_CHAT_ACTION = `${PROFESSIONAL_SAFETY_ACTION} I cannot give a driving test or repair procedure for this scan; a qualified mechanic should decide the next inspection in person.`;
export const SAFETY_FITMENT_ACTION = `${UNVERIFIED_FITMENT_BOUNDARY} ${PROFESSIONAL_SAFETY_ACTION}`;

/** Only fixed server replies can retain their full text in a critical conversation. */
export function safeChatContent(content: string) {
  return content === SAFETY_CHAT_ACTION || content === SAFETY_FITMENT_ACTION ? content : PROFESSIONAL_SAFETY_ACTION;
}
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
