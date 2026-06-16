import { getAIErrorDetails, identifyCapturedFrame, runAI, sendFollowUp } from "./aiService";
import { identifyOnDevice } from "./onDeviceIdentify";

vi.mock("./onDeviceIdentify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./onDeviceIdentify")>();
  return { ...actual, identifyOnDevice: vi.fn() };
});

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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the on-device model when offline and the fallback is enabled", async () => {
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const offlineResult = {
      ...result,
      partName: "Brake caliper",
      confidence: "low",
      modelRun: { provider: "on-device", model: "SmolVLM-256M", latencyMs: 12, fallbackReason: "offline", ocrUsed: false },
    };
    vi.mocked(identifyOnDevice).mockReset().mockResolvedValue(offlineResult as never);

    await expect(
      identifyCapturedFrame({ imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" }),
    ).resolves.toMatchObject({ modelRun: { provider: "on-device" } });

    expect(identifyOnDevice).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();

    onlineSpy.mockRestore();
  });

  it("does not use the on-device model for online cloud network errors", async () => {
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    vi.mocked(identifyOnDevice).mockReset();

    await expect(
      identifyCapturedFrame({ imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "network" });

    expect(identifyOnDevice).not.toHaveBeenCalled();
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

  it("preserves identify provider metadata from the API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result,
          modelRun: {
            provider: "huggingface",
            model: "Qwen/Qwen2.5-VL-7B-Instruct",
            latencyMs: 1234,
            fallbackReason: "rate_limited",
            ocrUsed: false,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      identifyCapturedFrame({
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      partName: "Alternator",
      modelRun: {
        provider: "huggingface",
        model: "Qwen/Qwen2.5-VL-7B-Instruct",
        fallbackReason: "rate_limited",
      },
    });
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
        },
        "What does it do?",
      ),
    ).resolves.toBe("The alternator charges the battery while the engine runs.");

    expect(JSON.stringify(fetchSpy.mock.calls[0][1]?.body)).toContain("Part name: Alternator");
  });
});
