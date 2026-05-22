import { AI_REQUEST_TIMEOUT_MS, getAIErrorDetails, identifyCapturedFrame, runAI, sendFollowUp } from "./aiService";

const result = {
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  candidateMatches: [
    {
      partName: "Starter motor",
      confidence: "low",
      scanCategory: "electrical",
      reason: "Also mounted nearby, but the visible pulley favors alternator.",
    },
  ],
  whatItDoes: "It charges the battery while the engine runs.",
  visibleObservations: ["Belt-driven metal housing is visible."],
  evidenceRegions: [
    {
      label: "Pulley",
      observation: "Belt-driven pulley is visible.",
      regionLabel: "Scanned area",
    },
  ],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Take another photo of the label if you need more detail.",
  needsBetterPhoto: false,
  evidence: ["The pulley and vented housing match common alternator shapes."],
  sourceLinks: [
    {
      label: "Search this part",
      url: "https://www.google.com/search?q=Alternator%20car%20part",
      sourceType: "search",
    },
  ],
};

describe("aiService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("routes vision calls through the identify API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      identifyCapturedFrame({
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      }),
    ).resolves.toEqual(result);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/identify",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("passes blurry label rescue hints to the identify API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await identifyCapturedFrame(
      {
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      },
      undefined,
      "too_blurry",
    );

    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toMatchObject({
      labelRescueTrigger: "too_blurry",
    });
  });

  it("throws a clean service error when the API rejects the request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "rate_limited",
            message: "Too many AI lookups right now. Try again in a few minutes.",
          },
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      identifyCapturedFrame({
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "rate_limited",
      message: "Too many AI lookups right now. Try again in a few minutes.",
    });
  });

  it("aborts scan requests that exceed the client timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_path, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );

    const scanPromise = identifyCapturedFrame({
      imageBase64: "data:image/jpeg;base64,test",
      capturedAt: "2026-05-16T00:00:00.000Z",
    });
    const expectation = expect(scanPromise).rejects.toMatchObject({
      code: "network",
      message: "Could not reach the Deep Spec AI service within the scan timeout.",
    });

    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS);

    await expectation;
  });

  it("classifies provider availability errors separately from model output errors", () => {
    expect(getAIErrorDetails("rate_limited")).toMatchObject({
      category: "provider_unavailable",
      title: "AI provider is rate-limited",
    });
    expect(getAIErrorDetails("invalid_response")).toMatchObject({
      category: "model_response",
      title: "AI response was unreadable",
    });
  });

  it("routes text calls through the chat API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "This is safe to inspect visually, but do not force anything." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      runAI({
        type: "text",
        userMessage: "What is this?",
        systemPrompt: "test",
      }),
    ).resolves.toBe("This is safe to inspect visually, but do not force anything.");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("builds follow-up chat from saved scan context", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "The alternator charges the battery while the engine runs." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      sendFollowUp(
        {
          id: "lookup-1",
          createdAt: "2026-05-16T00:00:00.000Z",
          frame: {
            imageBase64: "data:image/jpeg;base64,test",
            capturedAt: "2026-05-16T00:00:00.000Z",
          },
          result,
          rating: null,
          correction: null,
          notes: "",
          scanCategory: "electrical",
          trainingLabel: "Alternator",
          trainingStatus: "raw_unreviewed",
          chatHistory: [],
          modelRuns: [],
          syncEvents: [],
        },
        "What does it do?",
      ),
    ).resolves.toBe("The alternator charges the battery while the engine runs.");

    expect(JSON.stringify(fetchSpy.mock.calls[0][1]?.body)).toContain("Part name: Alternator");
  });
});
