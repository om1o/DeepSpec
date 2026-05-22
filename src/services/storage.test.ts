import {
  appendChatMessages,
  appendLookupModelRun,
  appendLookupSyncEvent,
  createChatMessage,
  DATASET_EXPORT_SCHEMA_VERSION,
  createLookup,
  deleteLookup,
  getDatasetExport,
  getLookupDatasetMetadata,
  getLookup,
  getLookups,
  LOOKUPS_STORAGE_KEY,
  MAX_SAVED_LOOKUPS,
  updateLookup,
  updateLookupResult,
} from "./storage";
import type { AIModelRun, ScanAnalysisState } from "../types";

const identifyModelRun: AIModelRun = {
  id: "run-identify-1",
  createdAt: "2026-05-16T00:00:05.000Z",
  kind: "identify",
  latencyMs: 1250,
  model: "gemini-2.5-flash",
  ocrModel: "gemini-2.5-flash",
  ocrText: "DENSO 104210",
  ocrUsed: true,
  promptVersion: "identify-v1",
  provider: "gemini",
};

const chatModelRun: AIModelRun = {
  id: "run-chat-1",
  createdAt: "2026-05-16T00:01:05.000Z",
  kind: "chat",
  latencyMs: 900,
  model: "gemini-2.5-flash",
  ocrUsed: false,
  promptVersion: "followup-v1",
  provider: "gemini",
};

const scanState: ScanAnalysisState = {
  frame: {
    imageBase64: "data:image/jpeg;base64,test",
    capturedAt: "2026-05-16T00:00:00.000Z",
  },
  analyzedAt: "2026-05-16T00:00:05.000Z",
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
  },
  modelRun: identifyModelRun,
};

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("creates and reads a saved lookup", () => {
    const result = createLookup(scanState);

    expect(result.ok).toBe(true);
    expect(getLookups()).toHaveLength(1);
    expect(getLookup(result.value.id)?.result?.partName).toBe("Alternator");
    expect(getLookup(result.value.id)).toMatchObject({
      modelRuns: [identifyModelRun],
      syncEvents: [],
      scanCategory: "electrical",
      trainingLabel: "Alternator",
      trainingStatus: "raw_unreviewed",
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

    const result = updateLookupResult(lookup.id, scanState.result!);

    expect(result.ok).toBe(true);
    const updated = getLookup(lookup.id);
    expect(updated).toMatchObject({
      errorMessage: undefined,
      errorCode: undefined,
      scanCategory: "electrical",
      trainingLabel: "Alternator",
    });
    expect(updated?.result?.partName).toBe("Alternator");
  });

  it("keeps model run and sync metadata for the training dataset", () => {
    const lookup = createLookup(scanState).value;

    appendLookupModelRun(lookup.id, chatModelRun);
    appendLookupSyncEvent(lookup.id, {
      imagePath: "user-1/lookup-1.jpg",
      message: "Scan synced to the private Deep Spec dataset.",
      status: "success",
    });

    const updated = getLookup(lookup.id);
    expect(updated?.modelRuns).toEqual([identifyModelRun, chatModelRun]);
    expect(updated?.syncEvents).toEqual([
      expect.objectContaining({
        imagePath: "user-1/lookup-1.jpg",
        message: "Scan synced to the private Deep Spec dataset.",
        status: "success",
      }),
    ]);
    expect(updated ? getLookupDatasetMetadata(updated, "user-1/lookup-1.jpg") : null).toMatchObject({
      chatMessageCount: 0,
      imagePath: "user-1/lookup-1.jpg",
      modelRuns: [identifyModelRun, chatModelRun],
      ocrText: "DENSO 104210",
      promptVersions: ["identify-v1", "followup-v1"],
      schemaVersion: 1,
      sourceUrls: ["https://www.google.com/search?q=Alternator%20car%20part"],
      syncEvents: [
        expect.objectContaining({
          imagePath: "user-1/lookup-1.jpg",
          status: "success",
        }),
      ],
    });
  });

  it("exports saved scans as dataset-ready JSON records", () => {
    const lookup = createLookup(scanState).value;
    appendChatMessages(lookup.id, [
      createChatMessage("user", "Is this urgent?"),
      createChatMessage("assistant", "No urgent damage is visible."),
    ]);
    appendLookupModelRun(lookup.id, chatModelRun);
    appendLookupSyncEvent(lookup.id, {
      message: "Cloud sync failed: Database error creating anonymous user.",
      status: "failure",
    });
    updateLookup(lookup.id, {
      correction: "Denso alternator",
      notes: "Driver side of engine bay.",
      rating: "down",
    });

    const savedLookup = getLookup(lookup.id);
    const datasetExport = getDatasetExport(savedLookup ? [savedLookup] : [], "2026-05-22T12:00:00.000Z");

    expect(datasetExport).toMatchObject({
      exportedAt: "2026-05-22T12:00:00.000Z",
      scanCount: 1,
      schemaVersion: DATASET_EXPORT_SCHEMA_VERSION,
    });
    const scan = datasetExport.scans[0];
    expect(scan).toMatchObject({
      analyzedAt: "2026-05-16T00:00:05.000Z",
      correction: "Denso alternator",
      imageBase64: "data:image/jpeg;base64,test",
      notes: "Driver side of engine bay.",
      rating: "down",
      result: expect.objectContaining({ partName: "Alternator" }),
      trainingLabel: "Denso alternator",
      trainingStatus: "user_corrected",
    });
    expect(scan.chatHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "Is this urgent?", role: "user" }),
      expect.objectContaining({ content: "No urgent damage is visible.", role: "assistant" }),
    ]));
    expect(scan.metadata).toMatchObject({
      chatMessageCount: 2,
      modelRuns: [identifyModelRun, chatModelRun],
      ocrText: "DENSO 104210",
      promptVersions: ["identify-v1", "followup-v1"],
      syncEvents: [expect.objectContaining({ status: "failure" })],
    });
    expect(scan.modelRuns).toEqual([identifyModelRun, chatModelRun]);
    expect(scan.syncEvents).toEqual([expect.objectContaining({ status: "failure" })]);
  });

  it("exports mirrored per-scan chat when the saved lookup index is stale", () => {
    const lookup = createLookup(scanState).value;
    const mirroredMessage = createChatMessage("user", "What is the part number?");
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([{ ...lookup, chatHistory: [] }]));
    localStorage.setItem(`deep-spec:chat:${lookup.id}`, JSON.stringify([mirroredMessage]));

    const datasetExport = getDatasetExport(undefined, "2026-05-22T12:00:00.000Z");

    expect(datasetExport.scans[0].chatHistory).toEqual([
      expect.objectContaining({ content: "What is the part number?", role: "user" }),
    ]);
    expect(datasetExport.scans[0].metadata).toMatchObject({
      chatMessageCount: 1,
    });
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

  it("caps saved scans so the local database stays bounded", () => {
    const firstLookup = createLookup(scanState).value;
    appendChatMessages(firstLookup.id, [createChatMessage("user", "Keep this with the first scan.")]);

    for (let index = 0; index < MAX_SAVED_LOOKUPS + 5; index += 1) {
      createLookup({
        ...scanState,
        frame: {
          ...scanState.frame,
          capturedAt: `2026-05-16T00:00:${String(index).padStart(2, "0")}.000Z`,
        },
        result: {
          ...scanState.result!,
          partName: `Alternator ${index}`,
        },
      });
    }

    const lookups = getLookups();

    expect(lookups).toHaveLength(MAX_SAVED_LOOKUPS);
    expect(lookups[0].result?.partName).toBe(`Alternator ${MAX_SAVED_LOOKUPS + 4}`);
    expect(lookups.some((lookup) => lookup.id === firstLookup.id)).toBe(false);
    expect(localStorage.getItem(`deep-spec:chat:${firstLookup.id}`)).toBeNull();
  });

  it("deletes a saved lookup", () => {
    const lookup = createLookup(scanState).value;

    expect(deleteLookup(lookup.id).ok).toBe(true);
    expect(getLookups()).toEqual([]);
  });

  it("ignores corrupt localStorage data", () => {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, "{bad json");

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
