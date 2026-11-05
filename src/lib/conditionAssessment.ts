import type { ConditionAssessment, ConditionObservation, NextConditionEvidence } from "../types";

const MAX_TEXT_LENGTH = 600;
const MAX_ID_LENGTH = 80;
const NEXT_EVIDENCE_KINDS = new Set<NextConditionEvidence["kind"]>([
  "photo", "marking", "measurement", "professional_inspection",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  const text = value.trim();
  return text || undefined;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ID_LENGTH && Boolean(value.trim());
}

function readReferences(value: unknown, allowedIds: ReadonlySet<string>, maxCount: number): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxCount) return undefined;
  const references = Array.from(value);
  if (!references.every((id): id is string => isId(id) && allowedIds.has(id))) return undefined;
  if (new Set(references).size !== references.length) return undefined;
  return references;
}

/** Reject the entire optional assessment when any evidence or reference is invalid. */
export function normalizeConditionAssessment(
  value: unknown,
  allowedPhotoIds: readonly string[],
): ConditionAssessment | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  if (!Array.isArray(value.observations) || value.observations.length < 1 || value.observations.length > 8) return undefined;
  if (!Array.isArray(value.possibleCauses) || value.possibleCauses.length > 4) return undefined;
  if (!Array.isArray(value.unknowns) || value.unknowns.length > 8) return undefined;

  const photoIds = new Set(allowedPhotoIds.filter(isId));
  const observationIds = new Set<string>();
  const observations: ConditionObservation[] = [];
  for (const observation of value.observations) {
    if (!isRecord(observation) || !isId(observation.id) || observationIds.has(observation.id)) return undefined;
    const text = readText(observation.text);
    const references = readReferences(observation.photoIds, photoIds, 4);
    const regionLabel = observation.regionLabel === undefined ? undefined : readText(observation.regionLabel, 120);
    if (!text || !references || (observation.regionLabel !== undefined && !regionLabel)) return undefined;
    observationIds.add(observation.id);
    observations.push({ id: observation.id, text, photoIds: references, ...(regionLabel ? { regionLabel } : {}) });
  }

  const possibleCauses: ConditionAssessment["possibleCauses"] = [];
  for (const cause of value.possibleCauses) {
    if (!isRecord(cause)) return undefined;
    const text = readText(cause.text);
    const references = readReferences(cause.observationIds, observationIds, 8);
    if (!text || !references) return undefined;
    possibleCauses.push({ text, observationIds: references });
  }

  const unknowns: string[] = [];
  for (const unknown of value.unknowns) {
    const text = readText(unknown);
    if (!text) return undefined;
    unknowns.push(text);
  }

  let nextEvidence: NextConditionEvidence | undefined;
  if (value.nextEvidence !== undefined) {
    const next = value.nextEvidence;
    if (!isRecord(next) || !NEXT_EVIDENCE_KINDS.has(next.kind as NextConditionEvidence["kind"])) return undefined;
    const request = readText(next.request);
    const purpose = readText(next.purpose);
    const references = next.photoIds === undefined ? undefined : readReferences(next.photoIds, photoIds, 4);
    if (!request || !purpose || (next.photoIds !== undefined && !references)) return undefined;
    nextEvidence = {
      kind: next.kind as NextConditionEvidence["kind"], request, purpose,
      ...(references ? { photoIds: references } : {}),
    };
  }

  return { version: 1, observations, possibleCauses, unknowns, ...(nextEvidence ? { nextEvidence } : {}) };
}
