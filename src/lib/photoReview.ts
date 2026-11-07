import type { PhotoReview, PhotoReviewStatus } from "../types/index.js";

const statuses = new Set<PhotoReviewStatus>(["observations_returned", "limited_view", "not_assessed"]);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,80}$/.test(value);
function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max && value.trim() ? value.trim() : undefined;
}

/** This validates model-reported structure, not whether the model examined a photo correctly. */
export function normalizePhotoReview(value: unknown, allowedPhotoIds: readonly string[]): PhotoReview | undefined {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.photos) || value.photos.length < 1 || value.photos.length > 4
    || !Array.isArray(value.disagreements) || value.disagreements.length > 2) return undefined;
  const allowed = new Set(allowedPhotoIds.filter(validId)), seen = new Set<string>();
  const photos: PhotoReview["photos"] = [];
  for (const row of value.photos) {
    if (!record(row) || !validId(row.photoId) || !allowed.has(row.photoId) || seen.has(row.photoId)
      || !statuses.has(row.status as PhotoReviewStatus)) return undefined;
    const summary = text(row.summary, 360);
    if (!summary) return undefined;
    seen.add(row.photoId);
    photos.push({ photoId: row.photoId, status: row.status as PhotoReviewStatus, summary });
  }
  const disagreementIds = new Set<string>(), disagreements: PhotoReview["disagreements"] = [];
  for (const item of value.disagreements) {
    if (!record(item) || !validId(item.id) || disagreementIds.has(item.id) || !Array.isArray(item.photoIds)
      || item.photoIds.length < 2 || item.photoIds.length > 4 || new Set(item.photoIds).size !== item.photoIds.length
      || !item.photoIds.every((id): id is string => validId(id) && photos.some((photo) => photo.photoId === id && photo.status !== "not_assessed"))
      || !record(item.nextEvidence)) return undefined;
    const description = text(item.description, 360), request = text(item.nextEvidence.request, 240), purpose = text(item.nextEvidence.purpose, 240);
    if (!description || !request || !purpose) return undefined;
    disagreementIds.add(item.id);
    disagreements.push({ id: item.id, photoIds: [...item.photoIds], description, nextEvidence: { request, purpose } });
  }
  return { version: 1, photos, disagreements };
}

export function photoReviewStatusLabel(status: PhotoReviewStatus | "not_reported"): string {
  switch (status) {
    case "observations_returned": return "Observations returned";
    case "limited_view": return "Limited view";
    case "not_assessed": return "Not assessed";
    default: return "No review returned";
  }
}

export type PhotoReviewSource = { id: string; label: string };
export const INDEPENDENT_PHOTO_COMPARISON_MESSAGE = "Cross-photo disagreements do not apply to independent examples. Review each photo separately.";

/** Apply relationship semantics after structural validation; never mutate the saved model response. */
export function photoReviewForRelationship(review: PhotoReview | undefined, relationship: unknown): PhotoReview | undefined {
  return review && relationship === "independent" ? { ...review, disagreements: [] } : review;
}

export function buildPhotoReviewState(value: unknown, photos: readonly PhotoReviewSource[], hasResult: boolean, relationship?: unknown) {
  const savedReview = hasResult ? normalizePhotoReview(value, photos.map((photo) => photo.id)) : undefined;
  const review = photoReviewForRelationship(savedReview, relationship);
  const invalid = hasResult && value !== undefined && !savedReview;
  const independent = relationship === "independent";
  return {
    review, invalid,
    sourceMessage: independent ? "These are independent examples. A shared vehicle, part or time sequence is not established."
      : "Saved images may include crops of another image; separate capture angles are not verified.",
    message: !hasResult ? "No AI identification or photo review is recorded."
      : invalid ? "The saved photo review could not be validated. Coverage and disagreements are unavailable."
        : !review ? "Photo-by-photo review was not reported for this result."
          : `${review.photos.length} of ${photos.length} photos have an AI review entry. This is not proof of complete or correct inspection.`,
    rows: photos.map((photo) => {
      const entry = review?.photos.find((row) => row.photoId === photo.id);
      return { ...photo, status: entry?.status ?? "not_reported" as const, summary: entry?.summary };
    }),
    comparisonHeading: independent ? "Independent examples" : "Reported disagreements",
    disagreementMessage: independent ? `${INDEPENDENT_PHOTO_COMPARISON_MESSAGE}${savedReview?.disagreements.length ? " A saved AI comparison was excluded because it does not apply to this relationship." : ""}`
      : !review ? "Disagreements were not recorded in a valid photo review."
      : !review.disagreements.length ? "No disagreements were reported. Agreement between the photos has not been verified."
        : "AI-reported disagreements need confirmation from the saved images and additional evidence.",
  };
}

export function formatPhotoReview(value: unknown, photos: readonly PhotoReviewSource[], hasResult: boolean, relationship?: unknown): string {
  const state = buildPhotoReviewState(value, photos, hasResult, relationship);
  const label = (id: string) => `${photos.find((photo) => photo.id === id)!.label} [${id}]`;
  return [
    "Photo review (AI-reported, not human confirmation):", state.sourceMessage, state.message,
    ...state.rows.map((row) => `- ${row.label} [${row.id}]: ${photoReviewStatusLabel(row.status)}${row.summary ? ` — Original AI summary (unverified): ${row.summary}` : ""}`),
    state.disagreementMessage,
    ...(state.review?.disagreements.flatMap((item) => [
      `- [${item.id}] ${item.photoIds.map(label).join(" / ")}: ${item.description}`,
      `Next evidence: ${item.nextEvidence.request}`, `Why: ${item.nextEvidence.purpose}`,
    ]) ?? []),
  ].join("\n");
}
