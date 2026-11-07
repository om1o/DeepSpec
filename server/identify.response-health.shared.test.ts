import { createIdentifyResponse } from "./identify.shared";

const env = { GEMINI_API_KEY: "test-only-key" };
const photos = ["overview", "close_up", "marking"].map((label, index) => ({
  id: `photo-${index + 1}`, label, imageBase64: "data:image/png;base64,aGVsbG8=",
}));
const request = { photos, photoRelationship: "independent" };
const result = {
  partName: "Alternator", confidence: "medium", scanCategory: "electrical",
  candidateMatches: [], whatItDoes: "Charges the battery.",
  visibleObservations: ["A pulley is visible."], evidenceRegions: [], concerns: [],
  safetyTriage: "can_help", isSafetyCritical: false, nextAction: "Photograph the marking.",
  needsBetterPhoto: false, evidence: ["A pulley is visible."], sourceLinks: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const answer = (finishReason: string | undefined = "STOP", text = JSON.stringify(result)) => json({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });

describe("identification provider response health", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(["MAX_TOKENS", "CONTINUATION", "OTHER", "FINISH_REASON_UNSPECIFIED"])("rejects parseable JSON from unfinished output (%s)", async (finishReason) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer(finishReason));
    const response = await createIdentifyResponse(request, env);
    expect(response).toMatchObject({ status: 502, body: { error: { code: "incomplete_response" } } });
    expect(response.body).not.toHaveProperty("result");
    expect(response.body).not.toHaveProperty("modelRun");
    expect(console.info).not.toHaveBeenCalled();
  });

  it("requires explicit completion even when a candidate has valid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }));
    await expect(createIdentifyResponse(request, env)).resolves.toMatchObject({ status: 502, body: { error: { code: "incomplete_response" } } });
  });

  it.each(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"])("stops %s without rescue or other provider requests", async (reason) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer(reason));
    await expect(createIdentifyResponse(request, { ...env, GEMINI_FALLBACK_MODELS: "fallback-one", DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true", HF_TOKEN: "test-hf" }))
      .resolves.toMatchObject({ status: 422, body: { error: { code: "response_blocked" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(console.info).not.toHaveBeenCalled();
  });

  it("honors prompt blocks with no candidate instead of sending a compact rescue", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ promptFeedback: { blockReason: "SAFETY" } }));
    await expect(createIdentifyResponse(request, env)).resolves.toMatchObject({ status: 422, body: { error: { code: "response_blocked" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts an already-started hedge when a provider block arrives", async () => {
    vi.useFakeTimers();
    let finishFirst!: (value: Response) => void;
    let hedgeSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        hedgeSignal = options?.signal as AbortSignal;
        hedgeSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }));
    const pending = createIdentifyResponse(request, { ...env, GEMINI_FALLBACK_MODELS: "fallback-one", DEEPSPEC_GEMINI_IDENTIFY_HEDGE_DELAY_MS: "10" });
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    finishFirst(answer("SAFETY"));
    await expect(pending).resolves.toMatchObject({ status: 422, body: { error: { code: "response_blocked" } } });
    expect(hedgeSignal?.aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("never treats thought-only JSON as an inspection", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, text: JSON.stringify(result) },
    ] } }] }));
    await expect(createIdentifyResponse(request, env)).resolves.toMatchObject({ status: 502, body: { error: { code: "invalid_response" } } });
  });

  it("parses final JSON without intermediate model notes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, text: JSON.stringify({ ...result, partName: "Starter motor" }) },
      { text: JSON.stringify(result) },
    ] } }] }));
    await expect(createIdentifyResponse(request, env)).resolves.toMatchObject({ status: 200, body: { result: { partName: "Alternator" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([["MAX_TOKENS", 502, "incomplete_response"], ["SAFETY", 422, "response_blocked"]] as const)("applies completion checks to compact rescue (%s)", async (finishReason, status, code) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer("STOP", "not JSON"))
      .mockResolvedValueOnce(answer(finishReason));
    await expect(createIdentifyResponse(request, env)).resolves.toMatchObject({ status, body: { error: { code } } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("allows complete compact rescue and retains all three photos", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer("MAX_TOKENS"))
      .mockResolvedValueOnce(answer("STOP"));
    await expect(createIdentifyResponse(request, env)).resolves.toMatchObject({ status: 200, body: { modelRun: { fallbackReason: "compact_rescue" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchSpy.mock.calls) {
      const sent = JSON.parse(String(options?.body));
      expect(sent.contents[0].parts.filter((part: Record<string, unknown>) => part.inline_data)).toHaveLength(3);
    }
  });

  it.each([400, 401, 403, 404])("does not retry a permanent Gemini HTTP %s error or expose its diagnostic message", async (status) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ error: { message: "private-project / test-only-key" } }, status));
    const response = await createIdentifyResponse(request, { ...env, GEMINI_FALLBACK_MODELS: "fallback-one" });
    expect(response).toMatchObject({ status, body: { error: { code: "provider_error" } } });
    expect(JSON.stringify([response, vi.mocked(console.warn).mock.calls])).not.toMatch(/private-project|test-only-key/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
