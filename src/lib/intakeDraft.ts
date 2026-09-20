import type { Lookup } from "../types";
import { getIntakeReview } from "./intakeReview";

// Derived from the saved record so retries and inspection edits cannot leave a stale draft.
export function buildIntakeDraft(lookup: Lookup) {
  const result = lookup.result;
  const inspection = lookup.inspection;
  const confirmedName = inspection?.confirmedPartName.trim();
  const correction = lookup.correction?.trim();
  const checks: string[] = [];
  if (!result) checks.push(lookup.errorCode === "quality_rejected"
    ? "Review the rejected photo and quality guidance before deciding whether to take a new scan."
    : "Run identification again; no AI result is saved.");
  if (result?.needsBetterPhoto || result?.safetyTriage === "needs_better_photo" || result?.confirmationNeed === "one_more_angle") {
    checks.push("Take a clearer photo or another angle of the part and its label.");
  }
  if (!confirmedName) checks.push(result || correction ? "Verify the suggested identity against the part or a trusted reference." : "Identify the part using its markings or a trusted reference.");
  if (!inspection?.partNumber.trim()) checks.push("Read and record the part number.");
  checks.push("Verify vehicle fitment against a trusted catalog before ordering or listing.");
  if (result?.confidence !== "high" || result?.confirmationNeed === "reference_needed") {
    if (result && !confirmedName) checks.push("The AI identity needs more evidence.");
  }
  checks.push(...(result?.requiredNextEvidence ?? []).map((item) => item.trim()).filter(Boolean));
  if (result?.isSafetyCritical || result?.safetyTriage === "needs_professional") checks.push("Have a qualified professional assess this part before use.");
  if (!inspection || inspection.functionalStatus === "not_tested") checks.push("Perform an appropriate functional test; a photo cannot establish that the part works.");
  if (inspection?.functionalStatus === "failed") checks.push("Functional test failed; resolve the recorded failure before use.");
  if (inspection?.functionalStatus === "inconclusive") checks.push("Functional test was inconclusive; further testing is needed.");
  return {
    review: getIntakeReview(lookup),
    name: confirmedName || correction || result?.partName || "Unidentified part",
    identitySource: confirmedName ? "Human inspection" : correction ? "User correction — not independently verified" : result ? "AI suggestion — not verified" : "No identification saved",
    partNumber: inspection?.partNumber.trim() || "Not verified",
    functionStatus: inspection ? `${inspection.functionalStatus.replaceAll("_", " ")} (human record)` : "Not tested",
    observations: result?.visibleObservations ?? [],
    checks: [...new Set(checks)],
  };
}

export function formatIntakeDraft(lookup: Lookup) {
  const draft = buildIntakeDraft(lookup);
  return [
    "Automatic intake draft",
    `Record: ${lookup.id}`,
    `Identity status: ${draft.review.label}`,
    ...draft.review.reasons.map((reason) => `Unresolved: ${reason}`),
    ...(lookup.errorMessage ? [`Scan issue: ${lookup.errorMessage}`] : []),
    `Part: ${draft.name}`,
    `Identity source: ${draft.identitySource}`,
    `Part number: ${draft.partNumber}`,
    `Function: ${draft.functionStatus}`,
    "AI visible observations:",
    ...(draft.observations.length ? draft.observations.map((item) => `- ${item}`) : ["None recorded."]),
    "Checks before ordering, listing or use:",
    ...draft.checks.map((item) => `- ${item}`),
    "This draft does not certify condition, fitment or safety.",
  ].join("\n");
}
