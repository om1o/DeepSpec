import { normalizeConditionAssessment } from "./conditionAssessment.js";

export const UNLINKED_CONDITION_FLAGS_MESSAGE = "These saved AI flags are not linked to individual photos. They do not establish the condition of every photo or part.";
export const ORIGINAL_AI_WORDING_MESSAGE = "Original AI wording can contain unsupported claims about cause or severity. It is not a confirmed finding; compare the linked appearance, possible causes and unresolved questions.";
const MISSING_FINDINGS = "No photo-linked condition findings were returned for this photo. Missing findings do not mean no damage is present.";

/** Count saved references, never infer inspection completeness or condition from summary text. */
export function buildConditionCoverage(value: unknown, photoIds: readonly string[], hasResult: boolean) {
  const validPhotos = photoIds.length > 0 && photoIds.every((id) => typeof id === "string" && Boolean(id.trim()) && id.length <= 80)
    && new Set(photoIds).size === photoIds.length;
  const assessment = hasResult && validPhotos ? normalizeConditionAssessment(value, photoIds) : undefined;
  const photos = validPhotos ? photoIds.map((photoId) => {
    const observations = assessment?.observations.filter((item) => item.photoIds.includes(photoId)) ?? [];
    const observationIds = observations.map((item) => item.id);
    const possibleCauses = assessment?.possibleCauses.filter((item) => item.observationIds.some((id) => observationIds.includes(id))) ?? [];
    return { photoId, observationIds, observations, possibleCauses, message: !hasResult ? "No AI condition analysis is recorded for this photo."
      : observationIds.length ? `${observationIds.length} linked AI condition finding${observationIds.length === 1 ? "" : "s"}. This does not establish a complete inspection of the photo.`
        : MISSING_FINDINGS };
  }) : [];
  const linked = photos.filter((photo) => photo.observationIds.length > 0).length;
  return {
    assessment, photos,
    message: !hasResult ? "No AI condition analysis is recorded."
      : !validPhotos ? "Saved photo references are unavailable or ambiguous. Condition findings cannot be linked to images."
        : !assessment && value !== undefined ? "Saved condition findings could not be validated. No photo-linked condition findings are available. Missing findings do not mean no damage is present."
          : !assessment ? "No photo-linked condition findings were returned. Missing findings do not mean no damage is present."
            : `${linked} of ${photos.length} photos have linked AI condition findings. This does not establish a complete inspection.`,
  };
}

export function formatConditionCoverage(coverage: ReturnType<typeof buildConditionCoverage>): string {
  return ["Photo-linked condition coverage (AI-reported, not human confirmation):", coverage.message,
    ...coverage.photos.map((photo, index) => `Photo ${index + 1} [${photo.photoId}]: ${photo.message}${photo.observationIds.length ? ` Saved observation IDs: ${photo.observationIds.join(", ")}.` : ""}`),
  ].join("\n");
}
