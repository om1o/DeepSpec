import type { IdentificationResult, VisualFocusBox } from "../types";
import type { SimpleResultSummary } from "./simpleResultSummary";

// Kept identical to the regex inside simpleResultSummary.ts so the issue pointer
// fires exactly when that helper sets the "Visible issue" eyebrow.
const DAMAGE_WORDS = /\b(dent|scratch|crack|broken|damage|damaged|missing|detached|chip|rust|corrosion|leak|stain)\b/i;

/** The first sentence describing visible damage, or null when nothing looks wrong. */
export function findVisibleIssue(result: IdentificationResult): string | null {
  const concern = result.concerns.find((item) => DAMAGE_WORDS.test(item));
  return concern ?? result.visibleObservations.find((item) => DAMAGE_WORDS.test(item)) ?? null;
}

export function summarize(value: string, limit: number) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(12, limit - 1)).trimEnd()}...`;
}

// Internal provenance strings that should never surface as user-facing evidence.
const PROVENANCE_PREFIX = /^(ocr label text|local dataset match|dataset source)\s*:/i;

export function getVisibleFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return [];
  }
  return result.visibleObservations
    .map((item) => summarize(item, compact ? 85 : 130))
    .filter(Boolean)
    .slice(0, compact ? 3 : 5);
}

export function getConcernFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return [];
  }

  return result.concerns
    .map((item) => summarize(item, compact ? 85 : 130))
    .filter(Boolean)
    .slice(0, compact ? 3 : 5);
}

export function getEvidenceFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return [];
  }

  return [
    ...result.evidence.filter((item) => !PROVENANCE_PREFIX.test(item.trim())),
    ...result.evidenceRegions.map((item) => `${item.regionLabel}: ${item.observation}`),
  ]
    .filter(Boolean)
    .map((item) => summarize(item, compact ? 90 : 145))
    .slice(0, compact ? 3 : 6);
}

/** Plain-language body line that names what the part does, without repeating the issue line. */
export function getAnswerBody(result: IdentificationResult, summary: SimpleResultSummary): string {
  if (findVisibleIssue(result)) {
    const what = result.whatItDoes?.trim();
    return what ? summarize(what, 150) : summary.body;
  }
  return summary.body;
}

export type DerivedIssue = {
  text: string;
  anchor: VisualFocusBox | null;
};

/** Pull the single most relevant visible issue plus a place to point at it, or null. */
export function deriveIssue(result: IdentificationResult): DerivedIssue | null {
  const text = findVisibleIssue(result);
  if (!text) {
    return null;
  }

  return {
    text: summarize(text, 96),
    anchor: anchorFromDamageRegion(result),
  };
}

function anchorFromDamageRegion(result: IdentificationResult): VisualFocusBox | null {
  const region = result.evidenceRegions.find((item) => DAMAGE_WORDS.test(item.observation));
  return region ? regionLabelToBox(region.regionLabel) : null;
}

/**
 * Map the model's coarse region vocabulary ("upper left", "center", "right side", ...)
 * to a normalized box centered on the matching 3x3 cell. Unknown labels return null so
 * callers can fall back to the focus box center.
 */
export function regionLabelToBox(regionLabel: string): VisualFocusBox | null {
  const label = regionLabel.toLowerCase();
  if (!/\b(left|right|upper|lower|top|bottom|center|centre|middle)\b/.test(label)) {
    return null;
  }

  const col = label.includes("left") ? 0 : label.includes("right") ? 2 : 1;
  const row = label.includes("upper") || label.includes("top")
    ? 0
    : label.includes("lower") || label.includes("bottom")
      ? 2
      : 1;

  const size = 0.32;
  const centerX = col * (1 / 3) + 1 / 6;
  const centerY = row * (1 / 3) + 1 / 6;

  return {
    confidence: 0.5,
    height: size,
    width: size,
    x: clamp01(centerX - size / 2),
    y: clamp01(centerY - size / 2),
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
