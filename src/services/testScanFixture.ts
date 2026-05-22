import type { IdentificationResult } from "../types";

export const TEST_ENGINE_IMAGE_URL = "/test-fixtures/engine-scan-test.jpg";
export const TEST_VEHICLE_LABEL = "Generated engine bay QA photo";

export const TEST_ENGINE_IDENTIFICATION: IdentificationResult = {
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  whatItDoes: "It charges the battery and helps power electrical systems while the engine is running.",
  visibleObservations: [
    "Belt-driven pulley is visible on the front of the component.",
    "Vented metal housing matches a common alternator shape.",
  ],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Use this QA result to verify the scanner and result UI. For a real car, scan the actual part from two angles before acting.",
  needsBetterPhoto: false,
  evidence: [
    "QA fixture result: generated engine bay photo.",
    "Pulley position and vented housing are consistent with an alternator.",
  ],
};
