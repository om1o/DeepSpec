import type { IdentificationResult } from "../../types";

export type VisualEvidenceMode = "locking" | "grounded" | "needs_evidence" | "measure" | "blocked";

export type VisualEvidenceSource = "target_lock" | "ai_evidence" | "measurement_reference" | "user_correction";

export type VisualEvidenceTarget = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  normalized?: {
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  };
};

export type VisualEvidenceAnchor = {
  detail: string;
  id: string;
  label: string;
  source: VisualEvidenceSource;
};

export type VisualEvidenceLayer = {
  anchors: VisualEvidenceAnchor[];
  confidenceRange: {
    low: number;
    high: number;
  } | null;
  isFallbackEstimate: boolean;
  label: string;
  mode: VisualEvidenceMode;
  requiredEvidence: string[];
  source: VisualEvidenceSource;
  target: VisualEvidenceTarget | null;
};

export function buildVisualEvidenceLayer(result: IdentificationResult, target: VisualEvidenceTarget | null): VisualEvidenceLayer {
  const requiredEvidence = getRequiredEvidence(result);
  const needsEvidence = result.confidence === "low"
    || result.needsBetterPhoto
    || result.confirmationNeed === "one_more_angle"
    || requiredEvidence.length > 0;
  const needsMeasure = result.confirmationNeed === "reference_needed"
    || requiredEvidence.some((item) => /measure|reference|size|coin|card/i.test(item));
  const weakTarget = Boolean(target && target.confidence < 0.72);
  const mode: VisualEvidenceMode = !target
    ? "blocked"
    : needsMeasure
      ? "measure"
      : needsEvidence
        ? "needs_evidence"
        : weakTarget
          ? "locking"
          : "grounded";

  return {
    anchors: getVisualEvidenceAnchors(result),
    confidenceRange: getConfidenceRange(result),
    isFallbackEstimate: result.modelRun?.provider === "on-device" || Boolean(result.modelRun?.fallbackReason),
    label: result.partName,
    mode,
    requiredEvidence,
    source: needsMeasure ? "measurement_reference" : "ai_evidence",
    target,
  };
}

function getVisualEvidenceAnchors(result: IdentificationResult): VisualEvidenceAnchor[] {
  const primaryLabel = result.partName.trim().toLowerCase();
  const regionAnchors = result.evidenceRegions
    .filter((region) => region.label.trim().toLowerCase() !== primaryLabel)
    .slice(0, 4)
    .map((region) => ({
      detail: summarize(region.observation || region.regionLabel, 38),
      id: `region:${region.regionLabel}:${region.label}`,
      label: region.label,
      source: "ai_evidence" as const,
    }));

  if (regionAnchors.length > 0) {
    return regionAnchors;
  }

  return result.evidence.slice(0, 2).map((evidence, index) => ({
    detail: summarize(evidence, 46),
    id: `evidence:${index}`,
    label: "Visible clue",
    source: "ai_evidence" as const,
  }));
}

function getRequiredEvidence(result: IdentificationResult) {
  if (result.requiredNextEvidence?.length) {
    return result.requiredNextEvidence.slice(0, 4);
  }

  if (result.confirmationNeed === "reference_needed") {
    return ["Add same-plane reference"];
  }

  if (result.confirmationNeed === "one_more_angle" || result.confidence === "low" || result.needsBetterPhoto) {
    return ["Second angle needed"];
  }

  return [];
}

function getConfidenceRange(result: IdentificationResult) {
  if (result.confidenceRange) {
    return {
      high: clampNumber(result.confidenceRange.high, 0, 100),
      low: clampNumber(result.confidenceRange.low, 0, 100),
    };
  }

  const score = result.confidenceScore ?? (result.confidence === "high" ? 84 : result.confidence === "medium" ? 72 : 48);
  const spread = result.confidence === "high" ? 8 : result.confidence === "medium" ? 12 : 18;
  return {
    high: clampNumber(Math.round(score + spread / 2), 0, 100),
    low: clampNumber(Math.round(score - spread), 0, 100),
  };
}

function summarize(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trim()}...` : clean;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
