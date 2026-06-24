import type { IdentificationResult } from "../types";

export type SimpleResultSummary = {
  body: string;
  eyebrow: "Best match" | "Detected" | "Visible issue";
  nextAction: string | null;
  title: string;
};

const DAMAGE_WORDS = /\b(dent|scratch|crack|broken|damage|damaged|missing|detached|chip|rust|corrosion|leak|stain)\b/i;
const GENERIC_NON_PART = /\b(not a vehicle part|unknown component|unidentified|unknown object)\b/i;

export function getSimpleResultSummary(result: IdentificationResult): SimpleResultSummary {
  const title = getSimpleTitle(result);
  const concern = result.concerns.find((item) => DAMAGE_WORDS.test(item));
  const visibleIssue = concern ?? result.visibleObservations.find((item) => DAMAGE_WORDS.test(item));
  const body = summarizeSentence(visibleIssue || result.whatItDoes || result.visibleObservations[0] || result.evidence[0] || "Deep Spec matched the visible item.");
  const needsPhoto = result.needsBetterPhoto || result.safetyTriage === "needs_better_photo" || GENERIC_NON_PART.test(result.partName);

  return {
    body,
    eyebrow: visibleIssue ? "Visible issue" : GENERIC_NON_PART.test(result.partName) ? "Detected" : "Best match",
    nextAction: needsPhoto ? summarizeSentence(result.nextAction || "Use a closer photo of the part.") : null,
    title,
  };
}

function getSimpleTitle(result: IdentificationResult) {
  const clean = result.partName.replace(/\s+/g, " ").trim();
  if (!clean || GENERIC_NON_PART.test(clean)) {
    return "Object detected";
  }

  return clean.replace(/^likely\s+/i, "");
}

function summarizeSentence(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "Deep Spec matched the visible item.";
  }

  const firstSentence = clean.match(/^.+?[.!?](?:\s|$)/)?.[0]?.trim() ?? clean;
  return firstSentence.length > 150 ? `${firstSentence.slice(0, 147).trimEnd()}...` : firstSentence;
}
