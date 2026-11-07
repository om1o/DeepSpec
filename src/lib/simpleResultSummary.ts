import type { IdentificationResult } from "../types";
import { describesVisibleDamage } from "./damageWords";

export type SimpleResultSummary = {
  body: string;
  eyebrow: "Best match" | "Identity unresolved" | "Visible issue";
  nextAction: string | null;
  title: string;
};

const GENERIC_NON_PART = /\b(not a vehicle part|unknown component|unidentified|unknown object)\b/i;
const UNRESOLVED_PLACEHOLDER = /^(unknown(?: part| item)?|not identified)[.!?]?$/i;

export function getSimpleResultSummary(result: IdentificationResult): SimpleResultSummary {
  const name = result.partName.replace(/\s+/g, " ").trim();
  const unresolved = !name || GENERIC_NON_PART.test(name) || UNRESOLVED_PLACEHOLDER.test(name);
  const title = unresolved ? "Identity unresolved" : name;
  const visibleIssue = result.visibleObservations.find((item) => describesVisibleDamage(item));
  const body = summarizeSentence(visibleIssue || (unresolved ? result.visibleObservations[0] || "The available evidence does not establish the item's identity."
    : result.whatItDoes || result.visibleObservations[0] || result.evidence[0] || "Review the visible clues to check this suggested match."));
  const needsPhoto = result.needsBetterPhoto || result.safetyTriage === "needs_better_photo" || unresolved;
  const needsSafetyCheck = result.isSafetyCritical || result.safetyTriage === "needs_professional";

  return {
    body,
    eyebrow: unresolved ? "Identity unresolved" : visibleIssue ? "Visible issue" : "Best match",
    nextAction: needsSafetyCheck ? result.nextAction.trim() || "Check this safety item before driving or repairing."
      : needsPhoto ? summarizeSentence(result.nextAction || "Use a closer photo of the part.") : null,
    title,
  };
}

function summarizeSentence(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "The available evidence does not establish the item's identity.";
  }

  const firstSentence = clean.match(/^.+?[.!?](?:\s|$)/)?.[0]?.trim() ?? clean;
  return firstSentence.length > 150 ? `${firstSentence.slice(0, 147).trimEnd()}...` : firstSentence;
}
