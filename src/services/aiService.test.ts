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

  it("uses the on-device model for online cloud provider availability errors", async () => {
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    vi.mocked(identifyOnDevice).mockReset().mockResolvedValue({
      ...result,
      confidence: "low",
      modelRun: { provider: "on-device", model: "SmolVLM-256M", latencyMs: 12, fallbackReason: "offline", ocrUsed: false },
    } as never);

    await expect(
      identifyCapturedFrame({ imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" }),
    ).resolves.toMatchObject({ modelRun: { provider: "on-device" } });

    expect(identifyOnDevice).toHaveBeenCalledOnce();
  });

  it("does not hide unreadable cloud model responses with the on-device fallback", async () => {
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "invalid_response",
            message: "Deep Spec received an unreadable AI response.",
          },
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.mocked(identifyOnDevice).mockReset();

    await expect(
      identifyCapturedFrame({ imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    expect(identifyOnDevice).not.toHaveBeenCalled();
  });

  it("returns the provider error when the online on-device fallback stalls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
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
    vi.mocked(identifyOnDevice).mockReset().mockReturnValue(new Promise(() => undefined) as never);

    const scan = identifyCapturedFrame({
      imageBase64: "data:image/jpeg;base64,test",
      capturedAt: "2026-05-16T00:00:00.000Z",
    });
    const rejection = expect(scan).rejects.toMatchObject({ code: "rate_limited" });
    await vi.advanceTimersByTimeAsync(90_000);

    await rejection;
    expect(identifyOnDevice).toHaveBeenCalledOnce();
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

  it("times out a hung identify request instead of leaving the scan loading", async () => {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, _timeout?: number, ...args: unknown[]) =>
      realSetTimeout(handler, 0, ...args)) as typeof setTimeout);
    vi.spyOn(globalThis, "fetch").mockImplementation((_path, options) => new Promise((_resolve, reject) => {
      const signal = (options as RequestInit | undefined)?.signal;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }) as never);

    await expect(
      identifyCapturedFrame({
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "network",
      message: "Scan took too long. Try again.",
    });
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
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "false");
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

  it("keeps the question inside the server's 3000-char cut on a long, detailed chat, and sends it once", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Yes, it's fine for a short drive." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const sentence = (n: number) => `Observation ${n}: ${"detail ".repeat(15).trim()}.`;
    const question = "Is it safe to drive to the shop tomorrow?";
    const longAnswer = `Answer: ${"The belt looks serviceable but check the tensioner. ".repeat(8).trim()}`;
    await sendFollowUp(
      {
        id: "lookup-long",
        createdAt: "2026-05-16T00:00:00.000Z",
        frame: { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" },
        result: {
          ...result,
          whatItDoes: "It charges the battery. ".repeat(19).trim(),
          nextAction: "Check belt tension and the charging voltage. ".repeat(10).trim(),
          visibleObservations: [1, 2, 3, 4, 5, 6].map(sentence),
          concerns: [7, 8, 9, 10, 11, 12].map(sentence),
        },
        rating: null,
        correction: null,
        notes: "",
        scanCategory: "electrical",
        trainingLabel: "Alternator",
        trainingStatus: "raw_unreviewed",
        chatHistory: [
          { id: "m1", role: "user", content: "Is the belt worn?", createdAt: "2026-05-16T00:01:00.000Z" },
          { id: "m2", role: "assistant", content: longAnswer, createdAt: "2026-05-16T00:01:05.000Z" },
          { id: "m3", role: "user", content: "What about the pulley?", createdAt: "2026-05-16T00:02:00.000Z" },
          { id: "m4", role: "assistant", content: longAnswer, createdAt: "2026-05-16T00:02:05.000Z" },
          // Chat saves the question before sending, so it is already the last message.
          { id: "m5", role: "user", content: question, createdAt: "2026-05-16T00:03:00.000Z" },
        ],
      },
      question,
    );

    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as { userMessage: string };
    const seenByServer = sent.userMessage.trim().slice(0, 3000); // api/chat.shared.ts parseChatRequest
    expect(seenByServer).toContain(`User question: ${question}`);
    expect(sent.userMessage.split(question)).toHaveLength(2); // sent exactly once
    expect(seenByServer).toContain("Part name: Alternator");
  });

  it("sends a multi-line question once even though the saved copy has its whitespace collapsed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Probably, but check it first." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // The textarea allows newlines; createChatMessage stores the question with whitespace collapsed.
    const typed = "Is it safe to drive\nto the shop   tomorrow?";
    const saved = "Is it safe to drive to the shop tomorrow?";
    await sendFollowUp(
      {
        id: "lookup-multiline",
        createdAt: "2026-05-16T00:00:00.000Z",
        frame: { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" },
        result,
        rating: null,
        correction: null,
        notes: "",
        scanCategory: "electrical",
        trainingLabel: "Alternator",
        trainingStatus: "raw_unreviewed",
        chatHistory: [{ id: "m1", role: "user", content: saved, createdAt: "2026-05-16T00:03:00.000Z" }],
      },
      typed,
    );

    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as { userMessage: string };
    expect(sent.userMessage).not.toContain("Recent chat:");
    expect(sent.userMessage.match(/to the shop/g)).toHaveLength(1);
  });
});
