import { PHOTO_RELATIONSHIPS, type PhotoRelationship } from "../types/index.js";

export function isPhotoRelationship(value: unknown): value is PhotoRelationship {
  return typeof value === "string" && PHOTO_RELATIONSHIPS.includes(value as PhotoRelationship);
}

/** Older records and absent declarations never imply a shared part or vehicle. */
export function photoRelationshipOrUnknown(value: unknown): PhotoRelationship {
  return isPhotoRelationship(value) ? value : "unknown";
}

export function photoRelationshipDescription(value: unknown): string {
  switch (photoRelationshipOrUnknown(value)) {
    case "same_part_or_area": return "Same part or area of one car — reported by the user, not independently verified.";
    case "independent": return "Independent examples — do not assume the same part, vehicle or before-and-after sequence.";
    default: return "Relationship unknown — a shared part, vehicle or sequence has not been established.";
  }
}

export function hasFirstPhotoIdentityScopePipeline(version?: string | null): boolean {
  return version === "identify-pipeline-2026-11-05-photo-relationship-v1"
    || version === "identify-pipeline-2026-11-05-photo-review-v1"
    || version === "identify-pipeline-2026-11-05-observation-areas-v1";
}

/** null means no identification result; undefined means its pipeline was not recorded. */
export function photoRelationshipScopeDescription(value: unknown, pipelineVersion?: string | null): string | undefined {
  if (photoRelationshipOrUnknown(value) === "same_part_or_area") {
    return pipelineVersion === null ? "No main identification is recorded." : undefined;
  }
  const identity = pipelineVersion === null ? "No main identification is recorded."
    : hasFirstPhotoIdentityScopePipeline(pipelineVersion) ? "The main identification refers to Photo 1."
      : "The main identification's per-photo scope was not recorded.";
  return `${identity} Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.`;
}
