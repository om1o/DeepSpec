import { describe, expect, it } from "vitest";
import type { PhotoReview } from "../types";
import { buildPhotoReviewState, formatPhotoReview, normalizePhotoReview } from "./photoReview";

const photos = ["a", "b", "c", "d"].map((id, index) => ({ id, label: `Photo ${index + 1}` }));
const review: PhotoReview = { version: 1, photos: [
  { photoId: "a", status: "observations_returned", summary: "Three mounting holes are visible." },
  { photoId: "b", status: "limited_view", summary: "Only two holes are visible; the far edge is hidden." },
], disagreements: [{ id: "mounting", photoIds: ["a", "b"], description: "The visible mounting patterns differ; an obscured hole may explain this.",
  nextEvidence: { request: "Show all mounting points in one clear view.", purpose: "Determine whether a hidden hole explains the apparent difference." } }] };

describe("photo review integrity and honest coverage", () => {
  it("keeps a partial review partial and links its disagreement to exact originals", () => {
    const state = buildPhotoReviewState(review, photos, true);
    expect(state.message).toContain("2 of 4 photos");
    expect(state.rows.map((row) => row.status)).toEqual(["observations_returned", "limited_view", "not_reported", "not_reported"]);
    expect(state.review?.disagreements[0].photoIds).toEqual(["a", "b"]);
    const output = formatPhotoReview(review, photos, true);
    expect(output).toContain("Photo 3 [c]: No review returned");
    expect(output).toContain("Photo 1 [a] / Photo 2 [b]");
    expect(output).toContain(review.disagreements[0].nextEvidence.request);
    expect(output).toContain("not proof of complete or correct inspection");
    expect(output).toContain("Saved images may include crops of another image; separate capture angles are not verified.");
  });
  it("does not derive legacy coverage or agreement from a successful identification", () => {
    const legacy = buildPhotoReviewState(undefined, photos, true);
    expect(legacy.rows.every((row) => row.status === "not_reported")).toBe(true);
    expect(legacy.message).toContain("not reported");
    expect(legacy.disagreementMessage).toContain("not recorded");
    expect(buildPhotoReviewState({ ...review, disagreements: [] }, photos, true).disagreementMessage).toContain("Agreement between the photos has not been verified");
    expect(buildPhotoReviewState(review, photos, false).review).toBeUndefined();
    expect(buildPhotoReviewState(review, photos, false).message).toContain("No AI identification");
  });
  it("records an explicitly unassessed photo without turning it into observations", () => {
    const partial = { ...review, photos: [...review.photos, { photoId: "c", status: "not_assessed", summary: "This view was not assessed." }] };
    expect(buildPhotoReviewState(partial, photos, true).rows[2].status).toBe("not_assessed");
    expect(buildPhotoReviewState(partial, photos, true).rows[3].status).toBe("not_reported");
  });
  it.each([
    { ...review, version: 2 },
    { ...review, photos: [] },
    { ...review, photos: [...review.photos, review.photos[0]] },
    { ...review, photos: [{ ...review.photos[0], photoId: "other-car" }] },
    { ...review, photos: [{ ...review.photos[0], status: "confirmed" }] },
    { ...review, photos: [{ ...review.photos[0], summary: " " }] },
    { ...review, photos: [{ ...review.photos[0], summary: "x".repeat(361) }] },
    { ...review, disagreements: [{ ...review.disagreements[0], photoIds: ["a", "c"] }] },
    { ...review, disagreements: [{ ...review.disagreements[0], photoIds: ["a", "a"] }] },
    { ...review, disagreements: [{ ...review.disagreements[0], photoIds: ["a"] }] },
    { ...review, disagreements: [review.disagreements[0], review.disagreements[0]] },
    { ...review, disagreements: [{ ...review.disagreements[0], description: "x".repeat(361) }] },
    { ...review, disagreements: [{ ...review.disagreements[0], nextEvidence: { request: "x".repeat(241), purpose: "Resolve it" } }] },
    { ...review, photos: [review.photos[0], { ...review.photos[1], status: "not_assessed" }] },
  ])("rejects invalid references or claims as one optional block %#", (invalid) => {
    expect(normalizePhotoReview(invalid, photos.map((photo) => photo.id))).toBeUndefined();
    const state = buildPhotoReviewState(invalid, photos, true);
    expect(state.invalid).toBe(true);
    expect(state.rows.every((row) => row.status === "not_reported")).toBe(true);
    expect(state.message).toContain("could not be validated");
    expect(state.review?.disagreements).toBeUndefined();
  });
});
