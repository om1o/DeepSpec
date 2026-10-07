import type { Lookup } from "../types";

export function getIntakeReview(scan: Partial<Pick<Lookup, "result" | "rating" | "inspection" | "errorMessage" | "errorCode">>) {
  const { result, inspection } = scan;
  if (inspection?.confirmedPartName.trim() && inspection.identityEvidence.trim()) {
    return { status: "human_recorded" as const, label: "Identity recorded by inspector", reasons: [] as string[] };
  }
  const reasons: string[] = [];
  if (scan.errorCode === "quality_rejected") reasons.push("Photo quality was insufficient; identification was not run.");
  else if (!result || scan.errorMessage) reasons.push("AI identification did not complete.");
  if (result) {
    if (result.needsBetterPhoto || result.safetyTriage === "needs_better_photo" || result.confirmationNeed === "one_more_angle") reasons.push("A clearer photo or another angle is needed.");
    if (result.confidence !== "high") reasons.push("The suggested identity has limited confidence.");
    if (result.confirmationNeed === "reference_needed") reasons.push("A label or reference is needed to distinguish the part.");
    if (result.scanCategory === "unknown" || !result.partName.trim()) reasons.push("The part is not supported by a usable identification.");
  }
  if (scan.rating === "down") reasons.push("The suggested identity was marked wrong.");
  return reasons.length
    ? { status: "unresolved" as const, label: "Identity unresolved", reasons }
    : { status: "needs_review" as const, label: "Identity awaiting review", reasons };
}
