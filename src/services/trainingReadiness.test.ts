import { getTrainingReadiness } from "./trainingReadiness";
import type { Lookup } from "../types";

const lookup: Lookup = {
  analyzedAt: "2026-05-16T00:00:05.000Z",
  chatHistory: [],
  correction: null,
  createdAt: "2026-05-16T00:00:00.000Z",
  frame: {
    capturedAt: "2026-05-16T00:00:00.000Z",
    imageBase64: "data:image/jpeg;base64,test",
  },
  id: "lookup-1",
  notes: "",
  rating: "up",
  result: {
    candidateMatches: [],
    confidence: "high",
    concerns: [],
    evidence: ["Pulley and housing match an alternator."],
    evidenceRegions: [],
    isSafetyCritical: false,
    needsBetterPhoto: false,
    nextAction: "Take another photo if needed.",
    partName: "Alternator",
    safetyTriage: "can_help",
    scanCategory: "electrical",
    sourceLinks: [],
    visibleObservations: ["Belt-driven housing is visible."],
    whatItDoes: "It charges the battery while the engine runs.",
  },
  scanCategory: "electrical",
  scanQuality: {
    accepted: true,
    averageLuminance: 126,
    brightPixelRatio: 0.01,
    brightnessScore: 98,
    cameraId: "rear-camera",
    checkedAt: "2026-05-16T00:00:01.000Z",
    darkPixelRatio: 0,
    firstPass: true,
    glareScore: 95,
    gradientVariance: 240,
    motionFallback: true,
    motionScore: null,
    motionStable: true,
    objectSizeRatio: 0.05,
    sampleHeight: 72,
    sampleWidth: 96,
    sharpnessScore: 100,
    targetCenteredScore: 82,
    targetConfidence: 0.82,
    targetLocked: true,
  },
  trainingLabel: "Alternator",
  trainingStatus: "user_confirmed",
};

describe("getTrainingReadiness", () => {
  it("marks confirmed clean scans as review-ready without implying training consent", () => {
    expect(getTrainingReadiness(lookup)).toMatchObject({
      action: "Keep private unless sharing is allowed.",
      label: "Review-ready",
      level: "ready",
      privacy: expect.stringContaining("Private by default"),
    });
  });

  it("blocks scans that need a better photo", () => {
    expect(getTrainingReadiness({
      ...lookup,
      result: {
        ...lookup.result!,
        needsBetterPhoto: true,
        safetyTriage: "needs_better_photo",
      },
    })).toMatchObject({
      action: "Retake with guide.",
      label: "Needs better photo",
      level: "not_ready",
    });
  });

  it("keeps unconfirmed scans in review instead of claiming readiness", () => {
    expect(getTrainingReadiness({
      ...lookup,
      rating: null,
      trainingStatus: "raw_unreviewed",
    })).toMatchObject({
      action: "Confirm the result or add one better angle.",
      label: "Needs review",
      level: "review",
      reasons: expect.arrayContaining(["The result has not been marked helpful yet."]),
    });
  });

  it("uses scan-quality measurements to explain a concrete retake action", () => {
    expect(getTrainingReadiness({
      ...lookup,
      scanQuality: {
        ...lookup.scanQuality!,
        sharpnessScore: 32,
      },
    })).toMatchObject({
      action: "Hold still and retake.",
      label: "Too blurry",
      level: "not_ready",
      reasons: ["Sharpness is below the usable range."],
    });
  });
});
