import { beforeEach, describe, expect, it } from "vitest";
import { accountStorageKey, setActiveAccount } from "../lib/accountScope";
import { createLookup, getLookup, LOOKUPS_STORAGE_KEY, normalizeLookup, readLookups, saveExistingLookup, scanStateFromLookup, updateLookupResult, updateLookupVisualSelection, withRetriedLookupResult } from "./storage";
import type { ConditionAssessment, IdentificationResult, PartInspection, ScanAnalysisState } from "../types";
const image = "data:image/jpeg;base64,YQ==";
const box = { x: 0.1, y: 0.1, width: 0.3, height: 0.4, confidence: 0.8 };
const state: ScanAnalysisState = {
  frame: { imageBase64: image, capturedAt: "2026-11-05T00:00:00Z" },
  photos: ["overview", "close_up", "marking"].map((label, index) => ({ id: `p${index}`, label: label as "overview", imageBase64: image, capturedAt: "2026-11-05T00:00:00Z" })),
  focusBox: box, focusMode: "mask", isolatedImageBase64: image,
  isolatedObjects: [
    { name: "Secondary", category: "electrical", primary: false, focusBox: box, isolatedImageBase64: image },
    { name: "Primary", category: "engine", primary: true, focusBox: box, isolatedImageBase64: image },
  ],
};
const conditionAssessment = (photoId: string): ConditionAssessment => ({
  version: 1, observations: [{ id: "edge", text: "Flaking is visible.", photoIds: [photoId] }],
  possibleCauses: [{ text: "Moisture exposure is possible.", observationIds: ["edge"] }],
  unknowns: ["Depth is unknown."],
  nextEvidence: { kind: "photo", request: "Photograph the rear surface.", purpose: "Show the currently hidden area.", photoIds: [photoId] },
});
const identification: IdentificationResult = {
  partName: "Rocker panel", confidence: "low", scanCategory: "body", candidateMatches: [],
  whatItDoes: "Body structure", visibleObservations: ["Orange flaking"], evidenceRegions: [], concerns: [],
  safetyTriage: "needs_professional", isSafetyCritical: true, nextAction: "Have the area inspected.", needsBetterPhoto: true,
  evidence: ["Visible edge"], sourceLinks: [],
};
const inspection: PartInspection = {
  confirmedPartName: "Rocker panel", partNumber: "", identityEvidence: "Checked vehicle location",
  visibleCondition: "uncertain", visibleNotes: "Rear surface not inspected", functionalStatus: "not_tested", functionalNotes: "",
  inspectorName: "Sam", inspectedAt: "2026-11-05T01:00:00.000Z",
};
describe("durable visual evidence", () => {
  beforeEach(() => { localStorage.clear(); setActiveAccount("owner"); });
  it("retains all photos and secondary cutouts through save, normalization and reopen", () => {
    const saved = createLookup(state);
    expect(saved.ok).toBe(true);
    const reopened = scanStateFromLookup(getLookup(saved.value.id)!);
    expect(reopened.photos).toEqual(state.photos);
    expect(reopened.isolatedObjects).toEqual(state.isolatedObjects);
    expect(reopened.frame).toEqual(state.frame);
    const retried = withRetriedLookupResult(saved.value, { frame: state.frame, result: { partName: "Updated" } as NonNullable<ScanAnalysisState["result"]> });
    expect(retried.photos).toEqual(state.photos);
    expect(retried.isolatedObjects).toEqual(state.isolatedObjects);
  });
  it("corrects the displayed secondary index without changing original pixels or primary cutout", () => {
    const saved = createLookup(state).value;
    const nextBox = { ...box, x: 0.5 };
    expect(updateLookupVisualSelection(saved.id, nextBox, 1).ok).toBe(true);
    const reopened = getLookup(saved.id)!;
    expect(reopened.isolatedObjects?.[0]).toMatchObject({ name: "Secondary", focusBox: nextBox, focusMode: "crop", isolatedImageBase64: "", correctedAt: expect.any(String) });
    expect(reopened.isolatedObjects?.[1]).toEqual(state.isolatedObjects?.[1]);
    expect(reopened.isolatedImageBase64).toBe(image);
    expect(reopened.frame).toEqual(state.frame);
    expect(reopened.result).toEqual(saved.result);
  });
  it("primary correction clears both stale cutouts and survives reopen", () => {
    const saved = createLookup(state).value;
    expect(updateLookupVisualSelection(saved.id, box, 0).ok).toBe(true);
    const reopened = getLookup(saved.id)!;
    expect(reopened.isolatedImageBase64).toBe("");
    expect(reopened.focusMode).toBe("crop");
    expect(reopened.isolatedObjects?.[1]).toMatchObject({ focusMode: "crop", isolatedImageBase64: "" });
    expect(updateLookupVisualSelection(saved.id, box, 9)).toMatchObject({ ok: false });
    setActiveAccount("other");
    expect(updateLookupVisualSelection(saved.id, box, null)).toMatchObject({ ok: false, value: null });
  });
  it("refuses a malformed extra photo instead of silently discarding it on the next write", () => {
    const saved = createLookup(state).value;
    const raw = JSON.stringify([{ ...saved, photos: [...state.photos!, { id: "broken" }] }]);
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), raw);
    expect(readLookups().ok).toBe(false);
    expect(createLookup(state).ok).toBe(false);
    expect(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY))).toBe(raw);
  });

  it("retains linked condition evidence through save, reopen and retry without replacing human inspection", () => {
    const assessment = conditionAssessment("p1");
    const saved = createLookup({ ...state, result: { ...identification, conditionAssessment: assessment } });
    expect(saved.ok).toBe(true);
    expect(scanStateFromLookup(getLookup(saved.value.id)!).result?.conditionAssessment).toEqual(assessment);
    const humanReviewed = { ...saved.value, inspection, rating: "up" as const, reviewStatus: "confirmed" as const };
    const retried = withRetriedLookupResult(humanReviewed, { frame: state.frame, result: { ...identification, conditionAssessment: conditionAssessment("p2") } });
    expect(retried.inspection).toEqual(inspection);
    expect(retried.result?.conditionAssessment).toEqual(conditionAssessment("p2"));
    expect(retried.result?.conditionAssessment).not.toHaveProperty("confirmed");
    expect(saveExistingLookup(retried).ok).toBe(true);
    expect(getLookup(saved.value.id)?.inspection).toEqual(inspection);
  });

  it.each(["photo-1", "missing-photo"])("omits invalid condition references at creation and persisted restore: %s", (photoId) => {
    const result = { ...identification, conditionAssessment: conditionAssessment(photoId) };
    const saved = createLookup({ ...state, result });
    expect(saved.ok).toBe(true);
    expect(saved.value.result).not.toHaveProperty("conditionAssessment");
    // Simulate an older/untrusted saved record that bypassed the current write boundary.
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{ ...saved.value, result, inspection, reviewStatus: "confirmed" }]));
    const reopened = getLookup(saved.value.id)!;
    expect(reopened.result?.partName).toBe(identification.partName);
    expect(reopened.result).not.toHaveProperty("conditionAssessment");
    expect(reopened.inspection).toEqual(inspection);
    expect(reopened.reviewStatus).toBe("confirmed");
  });

  it("checks the retry's actual replacement group and keeps human work when condition links no longer match", () => {
    const saved = createLookup({ ...state, result: identification }).value;
    const retried = withRetriedLookupResult({ ...saved, inspection }, {
      frame: state.frame, photos: [{ ...state.photos![0], id: "new-overview" }],
      result: { ...identification, conditionAssessment: conditionAssessment("p0") },
    });
    expect(retried.result?.partName).toBe(identification.partName);
    expect(retried.result).not.toHaveProperty("conditionAssessment");
    expect(retried.inspection).toEqual(inspection);
    const updated = updateLookupResult(saved.id, { ...identification, conditionAssessment: conditionAssessment("not-saved") });
    expect(updated.ok).toBe(true);
    expect(updated.value?.result).not.toHaveProperty("conditionAssessment");
  });

  it("accepts photo-1 only for the retained legacy original, not a missing second view or placeholder", () => {
    const saved = createLookup({ frame: state.frame, result: { ...identification, conditionAssessment: conditionAssessment("photo-1") } }).value;
    expect(getLookup(saved.id)?.result?.conditionAssessment).toEqual(conditionAssessment("photo-1"));
    expect(normalizeLookup({ ...saved, result: { ...identification, conditionAssessment: conditionAssessment("photo-2") } })?.result).not.toHaveProperty("conditionAssessment");
    expect(normalizeLookup({ ...saved, frame: { ...state.frame, imageBase64: "placeholder" } })?.result).not.toHaveProperty("conditionAssessment");
    expect(normalizeLookup({ ...saved, photos: [] })?.result).not.toHaveProperty("conditionAssessment");
  });
});
