import { getIntakeReview } from "./intakeReview";
import { emptyPartInspection } from "./partInspection";
import type { IdentificationResult } from "../types";

const result: IdentificationResult = {
  partName: "Alternator", confidence: "high", scanCategory: "electrical", candidateMatches: [],
  whatItDoes: "Charges battery", visibleObservations: [], evidenceRegions: [], concerns: [],
  safetyTriage: "can_help", isSafetyCritical: false, nextAction: "Check label", needsBetterPhoto: false,
  evidence: [], sourceLinks: [],
};

it("keeps a high-confidence helpful scan awaiting identity review", () => {
  expect(getIntakeReview({ result, rating: "up" }).status).toBe("needs_review");
});

it.each([
  { result: undefined },
  { result: { ...result, confidence: "low" as const } },
  { result: { ...result, confidence: "medium" as const } },
  { result: { ...result, scanCategory: "unknown" as const } },
  { result: { ...result, needsBetterPhoto: true } },
  { result: { ...result, confirmationNeed: "one_more_angle" as const } },
  { result: { ...result, confirmationNeed: "reference_needed" as const } },
  { result, rating: "down" as const },
  { result, errorMessage: "Provider failed" },
])("marks insufficient evidence as unresolved: %j", (input) => {
  const review = getIntakeReview(input);
  expect(review.status).toBe("unresolved");
  expect(review.reasons.length).toBeGreaterThan(0);
});

it("only records human identity when name and evidence exist, never from a functional test alone", () => {
  const inspection = { ...emptyPartInspection, inspectorName: "Pat", inspectedAt: "2026-09-20T12:00:00Z", functionalStatus: "passed" as const, functionalNotes: "Bench test" };
  expect(getIntakeReview({ result, inspection }).status).toBe("needs_review");
  expect(getIntakeReview({ result, inspection: { ...inspection, confirmedPartName: "Starter" } }).status).toBe("needs_review");
  expect(getIntakeReview({ inspection: { ...inspection, confirmedPartName: "Starter", identityEvidence: "Stamped label" } }).status).toBe("human_recorded");
});
