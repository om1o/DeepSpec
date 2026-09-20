import { accountStorageKey, setActiveAccount } from "../lib/accountScope";
import {
  appendChatMessages,
  createChatMessage,
  createLookup,
  saveLookupInspection,
  saveExistingLookup,
  deleteLookup,
  getLookup,
  getLookups,
  LOOKUPS_STORAGE_KEY,
  MAX_SAVED_LOOKUPS,
  scanStateFromLookup,
  updateLookup,
  updateLookupResult,
} from "./storage";
import type { ScanAnalysisState } from "../types";
import { emptyPartInspection } from "../lib/partInspection";

const scanState: ScanAnalysisState = {
  frame: {
    imageBase64: "data:image/jpeg;base64,test",
    capturedAt: "2026-05-16T00:00:00.000Z",
  },
  analyzedAt: "2026-05-16T00:00:05.000Z",
  provenance: {
    analysisSource: "ai_detection",
    captureMode: "camera",
    savedAt: "2026-05-16T00:00:05.000Z",
  },
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
    targetCenteredScore: 72,
    targetConfidence: 0.82,
    targetLocked: true,
  },
  result: {
    partName: "Alternator",
    confidence: "high",
    scanCategory: "electrical",
    candidateMatches: [
      {
        partName: "Starter motor",
        confidence: "low",
        scanCategory: "electrical",
        reason: "Also mounted nearby, but the pulley favors alternator.",
      },
    ],
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven housing is visible."],
    evidenceRegions: [
      {
        label: "Pulley",
        observation: "Belt-driven housing is visible.",
        regionLabel: "Scanned area",
      },
    ],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Take another photo if needed.",
    needsBetterPhoto: false,
    evidence: ["The pulley and housing match an alternator."],
    sourceLinks: [
      {
        label: "Search this part",
        url: "https://www.google.com/search?q=Alternator%20car%20part",
        sourceType: "search",
      },
    ],
    modelRun: {
      provider: "huggingface",
      model: "Qwen/Qwen2.5-VL-7B-Instruct",
      latencyMs: 1234,
      fallbackReason: "rate_limited",
      ocrUsed: false,
    },
  },
};

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("isolates scans and chat while preserving another account and unassigned records", () => {
    const legacy = JSON.stringify([{ id: "unassigned-record" }]);
    localStorage.setItem(LOOKUPS_STORAGE_KEY, legacy);
    setActiveAccount("owner-a");
    const saved = createLookup(scanState);
    expect(saved.ok).toBe(true);
    appendChatMessages(saved.value.id, [createChatMessage("user", "Private shop question")]);
    setActiveAccount("owner-b");
    expect(getLookups()).toEqual([]);
    expect(getLookup(saved.value.id)).toBeNull();
    setActiveAccount(null);
    expect(getLookups()).toEqual([]);
    expect(createLookup(scanState).ok).toBe(false);
    setActiveAccount("owner-a");
    expect(getLookups()).toHaveLength(1);
    expect(getLookup(saved.value.id)?.chatHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "Private shop question" }),
    ]));
    expect(localStorage.getItem(LOOKUPS_STORAGE_KEY)).toBe(legacy);
  });

  it("creates and reads a saved lookup", () => {
    const result = createLookup(scanState);

    expect(result.ok).toBe(true);
    expect(getLookups()).toHaveLength(1);
    expect(getLookup(result.value.id)?.result?.partName).toBe("Alternator");
    expect(getLookup(result.value.id)).toMatchObject({
      scanCategory: "electrical",
      scanQuality: {
        brightnessScore: 98,
        cameraId: "rear-camera",
        sharpnessScore: 100,
      },
      result: {
        modelRun: {
          provider: "huggingface",
          model: "Qwen/Qwen2.5-VL-7B-Instruct",
          fallbackReason: "rate_limited",
        },
      },
      provenance: {
        analysisSource: "ai_detection",
        captureMode: "camera",
        savedAt: "2026-05-16T00:00:05.000Z",
      },
      trainingLabel: "Alternator",
      trainingStatus: "raw_unreviewed",
    });
  });

  it("preserves focused item metadata and isolated output", () => {
    const result = createLookup({
      ...scanState,
      focusBox: {
        confidence: 0.92,
        height: 0.42,
        width: 0.38,
        x: 0.22,
        y: 0.18,
      },
      focusMode: "mask",
      isolatedImageBase64: "data:image/png;base64,isolated-output",
    });

    expect(result.ok).toBe(true);
    const lookup = getLookup(result.value.id);
    expect(lookup).toMatchObject({
      focusBox: {
        confidence: 0.92,
        height: 0.42,
        width: 0.38,
        x: 0.22,
        y: 0.18,
      },
      focusMode: "mask",
      isolatedImageBase64: "data:image/png;base64,isolated-output",
    });
    expect(scanStateFromLookup(lookup!)).toMatchObject({
      focusMode: "mask",
      isolatedImageBase64: "data:image/png;base64,isolated-output",
    });
  });

  it("updates rating, correction, and notes", () => {
    const lookup = createLookup(scanState).value;

    const result = updateLookup(lookup.id, {
      rating: "down",
      correction: "It was the power steering pump.",
      notes: "Passenger side of engine bay.",
    });

    expect(result.ok).toBe(true);
    expect(getLookup(lookup.id)).toMatchObject({
      rating: "down",
      correction: "It was the power steering pump.",
      notes: "Passenger side of engine bay.",
      scanCategory: "steering",
      trainingLabel: "It was the power steering pump.",
      trainingStatus: "user_corrected",
    });
  });

  // A correction's category overrides the model's. Keywords used to match inside other words
  // ("oil" in "coil", "gas" in "gasket", "body" in "throttle body").
  it.each([
    ["Ignition coil", "electrical"], // no category word → keeps the model's category
    ["Coil spring", "suspension"],
    ["Clock spring", "airbag"],
    ["Valve cover gasket", "engine"],
    ["Head gasket", "engine"],
    ["Throttle body", "engine"],
    ["Oil filter", "engine"],
    ["Oil pan", "engine"],
    ["Coolant reservoir", "engine"],
    ["Rear brake pads", "brakes"],
    ["Gas tank strap", "fuel"],
    ["Fuel injectors", "fuel"],
    ["Oil leak at the drain plug", "leak"],
    ["Front door panel", "body"],
    ["It was the power steering pump.", "steering"],
  ])("files the correction %j under %s", (correction, category) => {
    const lookup = createLookup(scanState).value;
    updateLookup(lookup.id, { correction });
    expect(getLookup(lookup.id)?.scanCategory).toBe(category);
  });

  it("preserves shop job context and mechanic-grade result fields", () => {
    const lookup = createLookup({
      ...scanState,
      customerVisibleReport: {
        generatedAt: "2026-05-16T00:00:06.000Z",
        summary: "Customer safe summary.",
        title: "Customer report",
      },
      jobId: "11111111-1111-4111-8111-111111111111",
      orgId: "00000000-0000-4000-8000-000000000001",
      reviewStatus: "needs_review",
      vehicleContext: {
        jobTitle: "Alternator job",
        make: "Toyota",
        model: "Camry",
        symptom: "Battery light.",
        technicianName: "Sam",
        year: "2014",
      },
      result: {
        ...scanState.result!,
        candidateParts: [
          {
            confidence: "high",
            evidence: ["Pulley and vented housing."],
            partName: "Alternator",
            scanCategory: "electrical",
          },
        ],
        fitmentConfidence: "needs_vehicle_context",
        primaryPart: {
          confidence: "high",
          evidence: ["Pulley and vented housing."],
          partName: "Alternator",
          scanCategory: "electrical",
        },
        requiredNextEvidence: ["VIN", "label photo"],
      },
    }).value;

    expect(getLookup(lookup.id)).toMatchObject({
      customerVisibleReport: {
        title: "Customer report",
      },
      jobId: "11111111-1111-4111-8111-111111111111",
      orgId: "00000000-0000-4000-8000-000000000001",
      reviewStatus: "needs_review",
      result: {
        candidateParts: [
          {
            partName: "Alternator",
          },
        ],
        fitmentConfidence: "needs_vehicle_context",
        requiredNextEvidence: ["VIN", "label photo"],
      },
      vehicleContext: {
        technicianName: "Sam",
      },
    });
  });

  it("updates AI result on successful retry", () => {
    const failedScanState: ScanAnalysisState = {
      frame: {
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      },
      errorMessage: "Connection timed out",
      errorCode: "network",
      analyzedAt: "2026-05-16T00:00:05.000Z",
    };
    const lookup = createLookup(failedScanState).value;
    expect(lookup.result).toBeUndefined();
    expect(lookup.errorMessage).toBe("Connection timed out");

    const result = updateLookupResult(lookup.id, scanState.result!, {
      analysisSource: "manual_retry",
      savedAt: "2026-05-16T00:00:06.000Z",
    });

    expect(result.ok).toBe(true);
    const updated = getLookup(lookup.id);
    expect(updated).toMatchObject({
      errorMessage: undefined,
      errorCode: undefined,
      provenance: {
        analysisSource: "manual_retry",
        captureMode: "camera",
        savedAt: "2026-05-16T00:00:06.000Z",
      },
      scanCategory: "electrical",
      trainingLabel: "Alternator",
    });
    expect(updated?.result?.partName).toBe("Alternator");
  });


  it("marks helpful scans as user-confirmed training data", () => {
    const lookup = createLookup(scanState).value;

    updateLookup(lookup.id, { rating: "up" });

    expect(getLookup(lookup.id)).toMatchObject({
      rating: "up",
      trainingLabel: "Alternator",
      trainingStatus: "user_confirmed",
    });
  });

  it("stores follow-up chat with the parent scan", () => {
    const lookup = createLookup(scanState).value;
    const userMessage = createChatMessage("user", "What does it do?".repeat(60));
    const assistantMessage = createChatMessage("assistant", "It charges the battery while the engine runs.");

    const result = appendChatMessages(lookup.id, [userMessage, assistantMessage]);

    expect(result.ok).toBe(true);
    expect(getLookup(lookup.id)?.chatHistory).toHaveLength(2);
    expect(getLookups()[0].chatHistory).toHaveLength(2);
    expect(getLookup(lookup.id)?.chatHistory[0]).toMatchObject({
      role: "user",
      content: expect.stringMatching(/^What does it do/),
    });
    expect(getLookup(lookup.id)?.chatHistory[0].content.length).toBeLessThanOrEqual(500);

    updateLookupResult(lookup.id, {
      ...scanState.result!,
      partName: "Serpentine belt",
    });

    expect(getLookups()[0].chatHistory).toHaveLength(2);
    expect(getLookup(lookup.id)?.chatHistory).toHaveLength(2);
  });

  it("refuses a 51st scan without discarding existing evidence, and permits freeing space", () => {
    const first = createLookup(scanState).value;
    updateLookup(first.id, { notes: "Unsynced bench notes" });
    appendChatMessages(first.id, [createChatMessage("user", "Keep the first scan's chat")]);
    for (let index = 1; index < MAX_SAVED_LOOKUPS; index += 1) expect(createLookup(scanState).ok).toBe(true);
    const before = localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY));
    expect(createLookup(scanState)).toMatchObject({ ok: false, message: expect.stringContaining("50") });
    expect(saveExistingLookup({ ...first, id: "new-cloud-copy" }).ok).toBe(false);
    expect(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY))).toBe(before);
    expect(getLookup(first.id)).toMatchObject({ notes: "Unsynced bench notes", chatHistory: [expect.objectContaining({ content: "Keep the first scan's chat" })] });
    expect(updateLookup(first.id, { notes: "Updated at capacity" }).ok).toBe(true);
    expect(deleteLookup(getLookups()[0].id).ok).toBe(true);
    expect(createLookup(scanState).ok).toBe(true);
    expect(getLookups()).toHaveLength(MAX_SAVED_LOOKUPS);
    expect(getLookup(first.id)?.notes).toBe("Updated at capacity");
  });

  it("persists human inspection without changing AI or training labels", () => {
    const lookup = createLookup(scanState).value;
    expect(lookup.inspection).toBeUndefined();
    const saved = saveLookupInspection(lookup.id, {
      ...emptyPartInspection, inspectorName: "Pat", confirmedPartName: "Starter motor",
      identityEvidence: "Matched the stamped number to the catalog", visibleCondition: "no_visible_damage",
    });
    expect(saved.ok).toBe(true);
    const reopened = getLookup(lookup.id)!;
    expect(reopened.inspection?.confirmedPartName).toBe("Starter motor");
    expect(reopened.inspection?.functionalStatus).toBe("not_tested");
    expect(reopened.result?.partName).toBe("Alternator");
    expect(reopened.trainingLabel).toBe(lookup.trainingLabel);
    expect(reopened.trainingStatus).toBe("raw_unreviewed");
    updateLookup(lookup.id, { notes: "Keep inspection" });
    expect(getLookup(lookup.id)?.inspection).toEqual(reopened.inspection);
  });

  it("rejects unsupported functional claims and preserves the prior record on storage failure", () => {
    const lookup = createLookup(scanState).value;
    expect(saveLookupInspection(lookup.id, { ...emptyPartInspection, inspectorName: "Pat", functionalStatus: "passed" }).ok).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    const saved = saveLookupInspection(lookup.id, { ...emptyPartInspection, inspectorName: "Pat" });
    expect(saved.ok).toBe(false);
    expect(saved.value?.inspection).toBeUndefined();
    expect(getLookup(lookup.id)?.inspection).toBeUndefined();
  });

  it("saves an existing scan id once without discarding newer local changes", () => {
    const original = createLookup(scanState).value;
    updateLookup(original.id, { notes: "Newer local note" });
    const saved = saveExistingLookup(original);
    expect(saved.ok).toBe(true);
    expect(getLookups()).toHaveLength(1);
    expect(getLookup(original.id)?.notes).toBe("Newer local note");
  });

  it("keeps existing human feedback when saving a cloud retry result", () => {
    const original = createLookup(scanState).value;
    updateLookup(original.id, { correction: "Starter motor", rating: "down", notes: "Keep technician note" });
    const saved = saveExistingLookup(original, { ...scanState, provenance: { ...original.provenance, analysisSource: "manual_retry" } });
    expect(saved.ok).toBe(true);
    expect(saved.value).toMatchObject({
      correction: "Starter motor", rating: "down", notes: "Keep technician note",
      trainingLabel: "Starter motor", trainingStatus: "user_corrected",
      provenance: { analysisSource: "manual_retry" },
    });
  });

  it("reports storage failure when saving a cloud copy", () => {
    const original = createLookup(scanState).value;
    localStorage.clear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    expect(saveExistingLookup(original).ok).toBe(false);
    expect(getLookup(original.id)).toBeNull();
  });

  it("deletes a saved lookup", () => {
    const lookup = createLookup(scanState).value;

    expect(deleteLookup(lookup.id).ok).toBe(true);
    expect(getLookups()).toEqual([]);
  });

  it("ignores corrupt localStorage data", () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), "{bad json");

    expect(getLookups()).toEqual([]);
  });

  it("returns a clean error when device storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    const result = createLookup(scanState);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("storage is full");
    expect(result.value.result?.partName).toBe("Alternator");
  });
});
