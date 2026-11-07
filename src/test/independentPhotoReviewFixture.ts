import type { Lookup, PhotoRelationship } from "../types";

// Review text reproduces PR #163's 2026-11-07 engine-bay/rotor failure.
// These tiny images are test placeholders, not the live benchmark photographs.
const imageBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bKkAAAAASUVORK5CYII=";
const capturedAt = "2026-11-07T12:00:00.000Z";

export function independentPhotoReviewFixture(photoRelationship: PhotoRelationship = "independent"): Lookup {
  return {
    id: "independent-review-fixture", createdAt: capturedAt, frame: { imageBase64, capturedAt },
    photos: ["bay", "rotor"].map((id) => ({ id, label: "other", imageBase64, capturedAt })),
    photoRelationship, scanCategory: "engine", rating: null, correction: null, notes: "",
    trainingLabel: "Engine Compartment", trainingStatus: "raw_unreviewed", chatHistory: [],
    provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: capturedAt },
    result: {
      partName: "Engine Compartment", confidence: "high", scanCategory: "engine", candidateMatches: [],
      whatItDoes: "Houses engine components.", visibleObservations: [], evidence: [], evidenceRegions: [],
      concerns: ["None visible in the primary overview image."], safetyTriage: "can_help", isSafetyCritical: false,
      nextAction: "Inspect the saved images.", needsBetterPhoto: false, sourceLinks: [],
      modelRun: { provider: "gemini", model: "gemini-3.5-flash-lite", latencyMs: 5071, ocrUsed: false,
        pipelineVersion: "identify-pipeline-2026-11-07-evidence-limits-v1" },
      photoReview: {
        version: 1,
        photos: [
          { photoId: "bay", status: "observations_returned", summary: "Overview of the engine compartment." },
          { photoId: "rotor", status: "observations_returned", summary: "Close-up of an independent brake rotor showing surface cracking." },
        ],
        disagreements: [{ id: "d1", photoIds: ["bay", "rotor"],
          description: "Photo 1 shows an engine compartment while Photo 2 shows an independent brake rotor example, representing completely different vehicle subsystems.",
          nextEvidence: { request: "Inspect specific vehicle subsystems individually.", purpose: "Clarify that the photos depict separate parts from independent examples." },
        }],
      },
    },
  };
}
