import type { IdentificationResult } from "../types";

export const TEST_ENGINE_IMAGE_URL = "/test-fixtures/engine-scan-test.jpg";
export const TEST_VEHICLE_LABEL = "Generated engine bay QA photo";

export const TEST_ENGINE_IDENTIFICATION: IdentificationResult = {
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  candidateMatches: [
    {
      partName: "Starter motor",
      confidence: "low",
      scanCategory: "electrical",
      reason: "Also found in the engine bay, but the visible pulley favors alternator.",
    },
  ],
  whatItDoes: "It charges the battery and helps power electrical systems while the engine is running.",
  visibleObservations: [
    "Belt-driven pulley is visible on the front of the component.",
    "Vented metal housing matches a common alternator shape.",
  ],
  evidenceRegions: [
    {
      label: "Pulley and housing",
      observation: "The belt-driven pulley and vented case are centered in the scanned area.",
      regionLabel: "Scanned area",
    },
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
  sourceLinks: [
    {
      label: "Search this part",
      sourceType: "search",
      url: "https://www.google.com/search?q=Alternator%20car%20part",
    },
  ],
};
