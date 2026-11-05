import { describe, expect, it } from "vitest";
import { photoRelationshipScopeDescription } from "./photoRelationship";

const CURRENT_PIPELINE = "identify-pipeline-2026-11-05-photo-relationship-v1";

describe("photo identity scope provenance", () => {
  it("preserves the first-photo scope for the newer review pipeline", () => {
    expect(photoRelationshipScopeDescription("independent", "identify-pipeline-2026-11-05-photo-review-v1")).toContain("The main identification refers to Photo 1.");
  });
  it.each(["independent", "unknown", undefined])("attributes identity to Photo 1 for %s only with the exact new pipeline", (relationship) => {
    expect(photoRelationshipScopeDescription(relationship, CURRENT_PIPELINE)).toBe("The main identification refers to Photo 1. Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.");
  });

  it.each([undefined, "", "identify-pipeline-2026-11-05-confirmed-vehicle-v1", `${CURRENT_PIPELINE}-other`])("keeps legacy or unrecognized identity scope unrecorded: %s", (pipeline) => {
    const text = photoRelationshipScopeDescription(undefined, pipeline);
    expect(text).toContain("The main identification's per-photo scope was not recorded.");
    expect(text).toContain("Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.");
    expect(text).not.toContain("The main identification refers to Photo 1.");
  });

  it("distinguishes no recorded identity from a legacy result without provenance", () => {
    expect(photoRelationshipScopeDescription("independent", null)).toContain("No main identification is recorded.");
    expect(photoRelationshipScopeDescription("independent", null)).not.toContain("per-photo scope was not recorded");
    expect(photoRelationshipScopeDescription("same_part_or_area", null)).toBe("No main identification is recorded.");
    expect(photoRelationshipScopeDescription("same_part_or_area", CURRENT_PIPELINE)).toBeUndefined();
  });
});
