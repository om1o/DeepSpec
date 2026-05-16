import {
  appendChatMessages,
  createChatMessage,
  createLookup,
  deleteLookup,
  getLookup,
  getLookups,
  LOOKUPS_STORAGE_KEY,
  MAX_SAVED_LOOKUPS,
  updateLookup,
} from "./storage";
import type { ScanAnalysisState } from "../types";

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
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven housing is visible."],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Take another photo if needed.",
    needsBetterPhoto: false,
    evidence: ["The pulley and housing match an alternator."],
  },
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
    expect(getLookup(lookup.id)?.chatHistory[0]).toMatchObject({
      role: "user",
      content: expect.stringMatching(/^What does it do/),
    });
    expect(getLookup(lookup.id)?.chatHistory[0].content.length).toBeLessThanOrEqual(500);
  });

  it("caps saved scans so the local database stays bounded", () => {
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
