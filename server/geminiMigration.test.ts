import { createChatResponse } from "./chat.shared";
import { createIdentifyResponse } from "./identify.shared";

const model = "gemini-3.5-flash-lite";
const imageBase64 = "data:image/png;base64,aGVsbG8=";
const env = { GEMINI_API_KEY: "mock-key" };
const identifiedPart = {
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  candidateMatches: [],
  whatItDoes: "Charges the battery.",
  visibleObservations: ["A pulley and vented metal housing are visible."],
  evidenceRegions: [],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Read the label before confirming the exact part.",
  needsBetterPhoto: false,
  evidence: ["A belt-driven pulley is visible."],
  sourceLinks: [],
};

function answer(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text, thoughtSignature: "opaque-signature" }] } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function limited() {
  return new Response("", { status: 429 });
}

function invoke(kind: "identify" | "chat", configured: Record<string, string | undefined>) {
  return kind === "identify"
    ? createIdentifyResponse({ imageBase64 }, configured)
    : createChatResponse({ userMessage: "What is visible?" }, configured);
}

describe("Gemini 3.5 migration", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected mocked provider request"));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the modern default and supported settings for structured identify", async () => {
    const fetchSpy = vi.mocked(fetch).mockResolvedValue(answer(JSON.stringify(identifiedPart)));
    await expect(createIdentifyResponse({ imageBase64 }, env)).resolves.toMatchObject({ status: 200, body: { modelRun: { model } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain(`/models/${model}:generateContent`);
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sent.generationConfig).toEqual({ maxOutputTokens: 2048, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "MINIMAL" } });
    expect(sent.contents).toHaveLength(1);
    expect(sent.contents[0].role).toBe("user");
    expect(sent.contents[0].parts[0].inline_data).toEqual({ mime_type: "image/png", data: "aGVsbG8=" });
  });

  it("uses modern settings again for compact rescue after invalid structured output", async () => {
    const fetchSpy = vi.mocked(fetch)
      .mockResolvedValueOnce(answer("not JSON"))
      .mockResolvedValueOnce(answer(JSON.stringify(identifiedPart)));
    await expect(createIdentifyResponse({ imageBase64 }, env)).resolves.toMatchObject({ status: 200, body: { modelRun: { model, fallbackReason: "compact_rescue" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(Array(2).fill(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`));
    const rescue = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(rescue.generationConfig).toEqual({ maxOutputTokens: 700, thinkingConfig: { thinkingLevel: "MINIMAL" } });
    expect(rescue.contents.at(-1).role).toBe("user");
  });

  it.each([false, true])("uses modern settings for chat with research=%s", async (research) => {
    const fetchSpy = vi.mocked(fetch).mockResolvedValue(answer("A pulley is visible."));
    await expect(createChatResponse({ userMessage: "What is visible?", imageBase64, research }, env)).resolves.toMatchObject({ status: 200, body: { message: "A pulley is visible." } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain(`/models/${model}:generateContent`);
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sent.generationConfig).toEqual({ maxOutputTokens: 1800, thinkingConfig: { thinkingLevel: "MINIMAL" } });
    expect(sent.contents).toHaveLength(1);
    expect(sent.contents[0].role).toBe("user");
    expect(sent.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/png", data: "aGVsbG8=" });
    if (research) expect(sent.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
    else expect(sent).not.toHaveProperty("tools");
  });

  it.each(["identify", "chat"] as const)("does not silently try a restricted legacy model after default %s is rate limited", async (kind) => {
    const fetchSpy = vi.mocked(fetch).mockImplementation(async () => limited());
    await expect(invoke(kind, env)).resolves.toMatchObject({ status: 429 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain(`/models/${model}:generateContent`);
  });

  it.each(["identify", "chat"] as const)("preserves explicit fallback order and deduplication for %s", async (kind) => {
    const fetchSpy = vi.mocked(fetch).mockImplementation(async () => limited());
    await expect(invoke(kind, {
      ...env,
      GEMINI_MODEL: ` ${model} `,
      GEMINI_CHAT_MODEL: ` ${model} `,
      GEMINI_CHAT_FALLBACK_MODELS: "gemini-2.5-flash-lite, gemini-2.5-flash-lite",
      GEMINI_FALLBACK_MODELS: `${model}, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-flash-lite`,
    })).resolves.toMatchObject({ status: 429 });
    const orderedModels = kind === "chat" ? [model, "gemini-2.5-flash-lite", "gemini-2.5-flash"] : [model, "gemini-2.5-flash", "gemini-2.5-flash-lite"];
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(orderedModels.map((name) => `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`));
    const configs = fetchSpy.mock.calls.map(([, request]) => JSON.parse(String(request?.body)).generationConfig);
    expect(configs[0].thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
    expect(configs[0]).not.toHaveProperty("temperature");
    for (const config of configs.slice(1)) {
      expect(config.thinkingConfig).toEqual({ thinkingBudget: 0 });
      expect(config.temperature).toBe(kind === "identify" ? 0.1 : 0.3);
    }
  });

  it.each(["identify", "chat"] as const)("retains the legacy fallback only for an explicitly selected 2.5 %s primary", async (kind) => {
    const fetchSpy = vi.mocked(fetch).mockImplementation(async () => limited());
    await expect(invoke(kind, { ...env, GEMINI_MODEL: "gemini-2.5-flash", GEMINI_CHAT_MODEL: "gemini-2.5-flash" })).resolves.toMatchObject({ status: 429 });
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(["gemini-2.5-flash", "gemini-2.5-flash-lite"].map((name) => `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`));
    for (const [, request] of fetchSpy.mock.calls) {
      expect(JSON.parse(String(request?.body)).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    }
  });

  it("does not launch an implicit legacy hedge while the default identify request is pending", async () => {
    vi.useFakeTimers();
    let finishPrimary!: (response: Response) => void;
    const fetchSpy = vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishPrimary = resolve; }))
      .mockResolvedValue(answer(JSON.stringify(identifiedPart)));
    const pending = createIdentifyResponse({ imageBase64 }, env);
    try {
      await vi.advanceTimersByTimeAsync(4001);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      finishPrimary(answer(JSON.stringify(identifiedPart)));
      await pending;
    }
    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it("preserves a deliberately configured nonzero legacy identify thinking budget", async () => {
    const fetchSpy = vi.mocked(fetch).mockResolvedValue(answer(JSON.stringify(identifiedPart)));
    await expect(createIdentifyResponse({ imageBase64 }, { ...env, GEMINI_MODEL: "gemini-2.5-flash", DEEPSPEC_GEMINI_IDENTIFY_THINKING_BUDGET: "256" })).resolves.toMatchObject({ status: 200 });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).generationConfig).toEqual({ maxOutputTokens: 2048, responseMimeType: "application/json", temperature: 0.1, thinkingConfig: { thinkingBudget: 256 } });
  });

  it("keeps a provider rejection of requested research visible", async () => {
    const fetchSpy = vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { message: "Research is unavailable for this provider account." } }), { status: 403, headers: { "Content-Type": "application/json" } }));
    await expect(createChatResponse({ userMessage: "Research this part", research: true }, env)).resolves.toEqual({ status: 403, body: { error: { code: "provider_error", message: "Research is unavailable for this provider account." } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
  });

  it("still hedges to an explicit fallback after four seconds and cancels the slower primary", async () => {
    vi.useFakeTimers();
    let primarySignal: AbortSignal | undefined;
    const fetchSpy = vi.mocked(fetch)
      .mockImplementationOnce((_url, request) => new Promise<Response>((_resolve, reject) => {
        primarySignal = request?.signal ?? undefined;
        primarySignal?.addEventListener("abort", () => reject(new Error("Cancelled slower primary")), { once: true });
      }))
      .mockResolvedValueOnce(answer(JSON.stringify(identifiedPart)));
    const pending = createIdentifyResponse({ imageBase64 }, { ...env, GEMINI_FALLBACK_MODELS: "gemini-2.5-flash-lite" });
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ status: 200, body: { modelRun: { model: "gemini-2.5-flash-lite" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(primarySignal?.aborted).toBe(true);
  });
});
