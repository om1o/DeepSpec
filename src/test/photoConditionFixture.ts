import { independentPhotoReviewFixture } from "./independentPhotoReviewFixture";

/** PR163's saved two-photo condition block, with stable test IDs and placeholder images. */
export function photoConditionFixture() {
  const lookup = independentPhotoReviewFixture();
  lookup.result!.conditionAssessment = {
    version: 2,
    observations: [{ id: "o1", text: "Standard factory engine compartment layout with visible intake manifold, battery, and fluid caps.",
      photoIds: ["bay"], regionLabel: "Engine bay overview", areas: [{ photoId: "bay", rectangle: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }] }],
    possibleCauses: [],
    unknowns: ["Internal component wear, fluid condition, and mechanical serviceability cannot be determined from a visual overview."],
    nextEvidence: { kind: "professional_inspection", request: "Perform a comprehensive mechanical and fluid inspection.", purpose: "To verify internal engine condition and operational safety." },
  };
  return lookup;
}
