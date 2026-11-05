import { getAIErrorDetails, identifyCapturedFrame, isAIRequestCanceled, runAI, sendFollowUp, sendFollowUpDetails } from "./aiService";
import { identifyOnDevice } from "./onDeviceIdentify";
import { setActiveAccount } from "../lib/accountScope";
import { compressImageDataUrl } from "../lib/utils";
import type { ConditionAssessment, ScanPhoto } from "../types";

vi.mock("./onDeviceIdentify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./onDeviceIdentify")>();
  return { ...actual, identifyOnDevice: vi.fn() };
});

vi.mock("../lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/utils")>();
  return { ...actual, compressImageDataUrl: vi.fn(async (value: string) => value) };
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

const conditionAssessment = (photoId: string): ConditionAssessment => ({
  version: 1,
  observations: [{ id: "rust-edge", text: "Orange flaking is visible along the edge.", photoIds: [photoId], regionLabel: "lower edge" }],
  possibleCauses: [{ text: "Moisture exposure is possible; its cause is unconfirmed.", observationIds: ["rust-edge"] }],
  unknowns: ["Depth and the condition behind the panel are unknown."],
  nextEvidence: { kind: "photo", request: "Photograph the back of this edge.", purpose: "Check whether the affected area is visible from behind.", photoIds: [photoId] },
});

describe("aiService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(compressImageDataUrl).mockReset().mockImplementation(async (value) => value);
    setActiveAccount("chat-test-owner");
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

  it("sends the complete labeled group once, without a duplicate legacy cover", async () => {
    const photos = ["overview", "close_up", "marking", "mounting"].map((label, index) => ({
      id: `photo-${index + 1}`, label, imageBase64: `data:image/jpeg;base64,${btoa(`view-${index}`)}`, capturedAt: "2026-11-05T00:00:00.000Z",
    })) as import("../types").ScanPhoto[];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result }), { status: 200 }));
    await identifyCapturedFrame(photos[0], undefined, undefined, { photos });
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.photos).toEqual(photos.map(({ id, label, imageBase64 }) => ({ id, label, imageBase64 })));
    expect(body).not.toHaveProperty("imageBase64");
    expect(body).not.toHaveProperty("imageBase64_2");
  });

  it.each(["detail", "photo-1", "unsubmitted-angle"])("validates condition references against the submitted group: %s", async (photoId) => {
    const photos: ScanPhoto[] = ["overview", "detail"].map((id) => ({ id, label: id === "overview" ? "overview" : "close_up",
      imageBase64: "data:image/jpeg;base64,dGVzdA==", capturedAt: "2026-11-05T00:00:00.000Z" }));
    const assessment = conditionAssessment(photoId);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: { ...result, conditionAssessment: assessment } }), { status: 200 }));
    const identified = await identifyCapturedFrame(photos[0], undefined, undefined, { photos });
    expect(identified.partName).toBe(result.partName);
    if (photoId === "detail") expect(identified.conditionAssessment).toEqual(assessment);
    else expect(identified).not.toHaveProperty("conditionAssessment");
  });

  it.each([
    { second: false, photoId: "photo-1", valid: true },
    { second: false, photoId: "photo-2", valid: false },
    { second: true, photoId: "photo-2", valid: true },
  ])("keeps legacy condition reference $photoId only when supplied (second photo: $second)", async ({ second, photoId, valid }) => {
    const frame = { imageBase64: "data:image/jpeg;base64,dGVzdA==", capturedAt: "2026-11-05T00:00:00.000Z" };
    const assessment = conditionAssessment(photoId);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: { ...result, conditionAssessment: assessment } }), { status: 200 }));
    const identified = await identifyCapturedFrame(frame, second ? frame : undefined);
    if (valid) expect(identified.conditionAssessment).toEqual(assessment);
    else expect(identified).not.toHaveProperty("conditionAssessment");
  });

  it("drops the whole optional assessment with a dangling cause but retains the legacy response", async () => {
    const assessment = { ...conditionAssessment("photo-1"), possibleCauses: [{ text: "Possible moisture exposure", observationIds: ["missing-observation"] }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: { ...result, conditionAssessment: assessment } }), { status: 200 }));
    const identified = await identifyCapturedFrame({ imageBase64: "data:image/jpeg;base64,dGVzdA==", capturedAt: "now" });
    expect(identified).toEqual(result);
  });

  it("does not ground an on-device fallback in the second photo it never received", async () => {
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    vi.mocked(identifyOnDevice).mockReset().mockResolvedValue({ ...result, conditionAssessment: conditionAssessment("photo-2") } as never);
    const frame = { imageBase64: "data:image/jpeg;base64,dGVzdA==", capturedAt: "now" };
    const identified = await identifyCapturedFrame(frame, frame);
    expect(identified.partName).toBe(result.partName);
    expect(identified).not.toHaveProperty("conditionAssessment");
    expect(identifyOnDevice).toHaveBeenCalledWith(frame);
  });

  it("does not drop angles into a single-photo offline fallback", async () => {
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.mocked(identifyOnDevice).mockClear();
    const photo = { id: "overview", label: "overview" as const, imageBase64: "data:image/jpeg;base64,dGVzdA==", capturedAt: "2026-11-05T00:00:00.000Z" };
    await expect(identifyCapturedFrame(photo, undefined, undefined, { photos: [photo] })).rejects.toMatchObject({ code: "network" });
    expect(identifyOnDevice).not.toHaveBeenCalled();
  });

  it("rejects duplicate evidence IDs before sending a group", async () => {
    const photo = { id: "overview", label: "overview" as const, imageBase64: "data:image/jpeg;base64,dGVzdA==", capturedAt: "2026-11-05T00:00:00.000Z" };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(identifyCapturedFrame(photo, undefined, undefined, { photos: [photo, photo] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("compresses an oversized scan before sending it to the identify API", async () => {
    const compressed = "data:image/jpeg;base64,dGVzdA==";
    vi.mocked(compressImageDataUrl).mockResolvedValue(compressed);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await identifyCapturedFrame({
      imageBase64: `data:image/jpeg;base64,${"A".repeat(3_800_001)}`,
      capturedAt: "2026-05-16T00:00:00.000Z",
    });

    expect(compressImageDataUrl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toHaveProperty("imageBase64", compressed);
  });

  it("rejects an image that cannot fit the request budget before network access", async () => {
    const oversized = `data:image/jpeg;base64,${"A".repeat(3_800_001)}`;
    vi.mocked(compressImageDataUrl).mockResolvedValue(oversized);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(identifyCapturedFrame({
      imageBase64: oversized,
      capturedAt: "2026-05-16T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "image_too_large" });

    expect(compressImageDataUrl).toHaveBeenCalledTimes(5);
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("aborts the active fetch without starting the on-device fallback when the caller cancels", async () => {
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.mocked(identifyOnDevice).mockReset();
    let fetchSignal: AbortSignal | null = null;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation((_path, options) => new Promise((_resolve, reject) => {
      fetchSignal = options?.signal ?? null;
      markFetchStarted();
      fetchSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }) as never);
    const controller = new AbortController();

    const scan = identifyCapturedFrame(
      { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" },
      undefined,
      undefined,
      { signal: controller.signal },
    ).catch((error: unknown) => error);
    await fetchStarted;
    controller.abort();

    const error = await scan;
    expect(isAIRequestCanceled(error)).toBe(true);
    expect(fetchSignal?.aborted).toBe(true);
    expect(identifyOnDevice).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 80_000],
    ["85000", 85_000],
    ["85001", 80_000],
  ])("uses the hosted identify client deadline %s within the 85-second ceiling", async (configured, expected) => {
    if (configured) vi.stubEnv("VITE_DEEPSPEC_IDENTIFY_CLIENT_TIMEOUT_MS", configured);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await identifyCapturedFrame({
      imageBase64: "data:image/jpeg;base64,test",
      capturedAt: "2026-05-16T00:00:00.000Z",
    });

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), expected);
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
    expect(getAIErrorDetails("feature_disabled")).toMatchObject({
      category: "setup",
      title: "Follow-up chat is unavailable",
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
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toHaveProperty("imageBase64", "data:image/jpeg;base64,test");
  });

  it("sends opt-in research references with the actual saved photo and keeps grounded response metadata", async () => {
    const sources = [{ label: "Service reference", url: "https://example.com/manual", sourceType: "reference" }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Visible wear\n\nCompare the belt marking.", sources, searchSuggestions: "<div>Related searches</div>" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const lookup = { frame: { imageBase64: "data:image/png;base64,aGVsbG8=", capturedAt: "2026-05-16T00:00:00.000Z" }, result, scanCategory: "electrical", trainingLabel: "Alternator", chatHistory: [] } as Parameters<typeof sendFollowUpDetails>[0];
    await expect(sendFollowUpDetails(lookup, "Research this marking", { research: true, sourceUrls: ["https://example.com/manual"] })).resolves.toEqual({ message: "Visible wear\n\nCompare the belt marking.", sources, searchSuggestions: "<div>Related searches</div>" });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({ imageBase64: lookup.frame.imageBase64, research: true, sourceUrls: ["https://example.com/manual"] });
  });

  it("attaches every labeled saved angle to a follow-up question", async () => {
    const photos = ["overview", "close_up"].map((label, index) => ({ id: `photo-${index}`, label,
      imageBase64: "data:image/png;base64,aGVsbG8=", capturedAt: "2026-11-05T00:00:00.000Z" })) as import("../types").ScanPhoto[];
    const lookup = { frame: photos[0], photos, result, scanCategory: "electrical", trainingLabel: "Alternator", chatHistory: [] } as Parameters<typeof sendFollowUpDetails>[0];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "The close-up does not establish depth." }), { status: 200 }));
    await expect(sendFollowUpDetails(lookup, "Compare these views")).resolves.toMatchObject({ message: "The close-up does not establish depth." });
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.photos).toEqual(photos.map(({ id, label, imageBase64 }) => ({ id, label, imageBase64 })));
    expect(body).not.toHaveProperty("imageBase64");
  });

  it("loads a signed cloud photo in the browser and sends bounded image data to chat", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { "Content-Type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "The saved photo shows the belt edge." }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const lookup = { frame: { imageBase64: "https://example.com/private.jpg", capturedAt: "2026-05-16T00:00:00.000Z" }, result, scanCategory: "electrical", trainingLabel: "Alternator", chatHistory: [] } as Parameters<typeof sendFollowUpDetails>[0];
    await sendFollowUp(lookup, "What do the observations mean?");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]).toEqual([lookup.frame.imageBase64, expect.objectContaining({ credentials: "omit" })]);
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/chat");
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toHaveProperty("imageBase64", "data:image/jpeg;base64,/9j/AA==");
  });

  it("keeps photo-linked appearance, unconfirmed causes and unknown severity in follow-up context", async () => {
    const photos = [{ id: "detail", label: "close_up" as const, imageBase64: "data:image/png;base64,aGVsbG8=", capturedAt: "2026-11-05T00:00:00Z" }];
    const assessment = {
      version: 1 as const,
      observations: [{ id: "o1", text: "Short radial lines are visible.", photoIds: ["detail"] }],
      possibleCauses: [{ text: "Heat checking is one possibility.", observationIds: ["o1"] }],
      unknowns: ["The photos do not establish depth or severity."],
      nextEvidence: { kind: "professional_inspection" as const, request: "Inspect both faces directly.", purpose: "Resolve whether the lines extend through the disc." },
    };
    const lookup = { frame: photos[0], photos, result: { ...result, conditionAssessment: assessment }, scanCategory: "brake", trainingLabel: "Rotor", chatHistory: [] } as Parameters<typeof sendFollowUpDetails>[0];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Depth remains unknown." }), { status: 200 }));
    await sendFollowUpDetails(lookup, "What does the second view establish?");
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.userMessage).toContain("Observed appearance [o1] in photos [detail]: Short radial lines are visible.");
    expect(body.userMessage).toContain("Unconfirmed possible cause, based on [o1]: Heat checking is one possibility.");
    expect(body.userMessage).toContain(assessment.unknowns[0]);
    expect(body.userMessage).toContain(assessment.nextEvidence.purpose);
    expect(body.userMessage).toContain("not human confirmation");
    expect(body.userMessage).toContain("User question: What does the second view establish?");
    expect(body.userMessage.length).toBeLessThanOrEqual(3000);
  });

  it("does not mix an old cloud photo with the new account's chat token after a switch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      setActiveAccount("different-owner");
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    });
    const lookup = { frame: { imageBase64: "https://example.com/private.jpg", capturedAt: "2026-05-16T00:00:00.000Z" }, result, scanCategory: "electrical", trainingLabel: "Alternator", chatHistory: [] } as Parameters<typeof sendFollowUpDetails>[0];
    await expect(sendFollowUp(lookup, "Inspect this photo")).rejects.toThrow("Account changed");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(lookup.frame.imageBase64);
  });

  it("reports an expired or unavailable cloud photo instead of silently using text-only chat", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("expired", { status: 403 }));
    const lookup = { frame: { imageBase64: "https://example.com/expired.jpg", capturedAt: "2026-05-16T00:00:00.000Z" }, result, scanCategory: "electrical", trainingLabel: "Alternator", chatHistory: [] } as Parameters<typeof sendFollowUpDetails>[0];
    await expect(sendFollowUp(lookup, "Inspect this photo")).rejects.toThrow("saved photo could not be loaded");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    const seenByServer = sent.userMessage.trim().slice(0, 3000); // server/chat.shared.ts parseChatRequest
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
