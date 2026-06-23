import type { Lookup, ScanQualitySnapshot } from "../types";

export type TrainingReadinessLevel = "ready" | "review" | "not_ready";

export type TrainingReadiness = {
  action: string;
  label: string;
  level: TrainingReadinessLevel;
  privacy: string;
  reasons: string[];
  score: number;
  summary: string;
};

const PRIVACY_MESSAGE = "Private by default. This photo is not used for model training unless sharing is allowed.";

export function getTrainingReadiness(lookup: Lookup): TrainingReadiness {
  const reasons: string[] = [];
  const quality = lookup.scanQuality;

  if (lookup.errorMessage || !lookup.result) {
    return createReadiness({
      action: "Run identify again.",
      label: "Not ready yet",
      level: "not_ready",
      reasons: ["No usable result is attached to this photo."],
      score: 0,
      summary: "Keep this scan private until it has a clean result.",
    });
  }

  if (lookup.result.needsBetterPhoto || lookup.result.safetyTriage === "needs_better_photo") {
    return createReadiness({
      action: "Retake with guide.",
      label: "Needs better photo",
      level: "not_ready",
      reasons: ["The result already asked for a better photo."],
      score: 20,
      summary: "This photo should not be used for learning yet.",
    });
  }

  if (!quality) {
    return createReadiness({
      action: "Check the label before sharing.",
      label: "Needs review",
      level: "review",
      reasons: ["Scan-quality measurements are missing."],
      score: 45,
      summary: "The answer can stay saved, but a person should review it first.",
    });
  }

  const qualityBlocker = getQualityBlocker(quality);
  if (qualityBlocker) {
    return createReadiness({
      action: qualityBlocker.action,
      label: qualityBlocker.label,
      level: "not_ready",
      reasons: [qualityBlocker.reason],
      score: qualityBlocker.score,
      summary: "This scan needs one cleaner capture before it helps the dataset.",
    });
  }

  if (lookup.correction?.trim()) {
    reasons.push("You corrected the label.");
    return createReadiness({
      action: "Keep the correction visible for review.",
      label: "Correction saved",
      level: "review",
      reasons,
      score: 70,
      summary: "Corrected scans are useful, but should be reviewed before learning.",
    });
  }

  if (lookup.rating !== "up") {
    reasons.push("The result has not been marked helpful yet.");
  }

  if (lookup.result.confirmationNeed === "one_more_angle" || lookup.result.confidence !== "high") {
    reasons.push("One more angle would improve trust.");
  }

  if (lookup.result.confirmationNeed === "reference_needed") {
    reasons.push("Exact size needs a reference object.");
  }

  if (quality.targetCenteredScore !== null && quality.targetCenteredScore < 50) {
    reasons.push("The object is not centered enough.");
  }

  if (reasons.length) {
    return createReadiness({
      action: "Confirm the result or add one better angle.",
      label: "Needs review",
      level: "review",
      reasons,
      score: 65,
      summary: "Saved safely. A quick human check makes this data much more useful.",
    });
  }

  return createReadiness({
    action: "Keep private unless sharing is allowed.",
    label: "Review-ready",
    level: "ready",
    reasons: ["Sharp photo, confirmed result, and enough quality data are present."],
    score: 90,
    summary: "This scan is ready for a human review queue.",
  });
}

function getQualityBlocker(quality: ScanQualitySnapshot) {
  if (quality.accepted === false || quality.failureReason) {
    return {
      action: quality.fixAction ?? "Retake with guide.",
      label: "Not ready yet",
      reason: formatReason(quality.failureReason ?? "needs_better_photo"),
      score: 15,
    };
  }

  if (quality.sharpnessScore !== null && quality.sharpnessScore < 65) {
    return {
      action: "Retake a steady photo.",
      label: "Soft photo",
      reason: "Sharpness is below the usable range.",
      score: quality.sharpnessScore,
    };
  }

  if (quality.brightnessScore !== null && quality.brightnessScore < 50) {
    return {
      action: "Add light or reduce glare.",
      label: "Lighting issue",
      reason: "Brightness is outside the usable range.",
      score: quality.brightnessScore,
    };
  }

  if (quality.glareScore !== null && quality.glareScore < 50) {
    return {
      action: "Shade the part and retake.",
      label: "Too much glare",
      reason: "Glare is covering useful detail.",
      score: quality.glareScore,
    };
  }

  if (quality.objectSizeRatio !== null && quality.objectSizeRatio < 0.018) {
    return {
      action: "Move closer.",
      label: "Object too small",
      reason: "The part takes up too little of the frame.",
      score: Math.round(quality.objectSizeRatio * 1000),
    };
  }

  return null;
}

function createReadiness(input: Omit<TrainingReadiness, "privacy">): TrainingReadiness {
  return {
    ...input,
    privacy: PRIVACY_MESSAGE,
  };
}

function formatReason(reason: string) {
  return reason.replaceAll("_", " ");
}
