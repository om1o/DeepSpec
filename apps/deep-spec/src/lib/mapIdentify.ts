import type { IdentifyJson, LookupResultPayload } from "../types";

function asStr(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

function asBool(x: unknown, fallback = false): boolean {
  return typeof x === "boolean" ? x : fallback;
}

function asStrArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

function asConfidence(x: unknown): LookupResultPayload["confidence"] {
  return x === "high" || x === "medium" || x === "low" ? x : "medium";
}

export function mapIdentifyJson(raw: unknown): LookupResultPayload {
  const j = raw as IdentifyJson;
  return {
    partName: asStr(j.part_name, "Unknown part").slice(0, 200),
    confidence: asConfidence(j.confidence),
    whatItDoes: asStr(j.what_it_does, ""),
    conditionObservations: asStrArray(j.condition_observations),
    concerns: asStrArray(j.concerns),
    isSafetyCritical: asBool(j.is_safety_critical),
    nextSteps: asStr(j.next_steps, ""),
    needsBetterPhoto: asBool(j.needs_better_photo),
    followUpQuestions: Array.isArray(j.follow_up_questions)
      ? j.follow_up_questions.filter((v): v is string => typeof v === "string")
      : [],
  };
}
