import { createChatResponse } from "./chat.shared";

const env = { GEMINI_API_KEY: "test-only-key" };
const question = { userMessage: "What can these photos establish?" };
const completeAnswer = "The photo shows surface corrosion; its depth is unknown.";
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const candidate = (finishReason: string | undefined, text = completeAnswer) => ({
  finishReason, content: { parts: [{ text }] },
});

describe("chat provider response health", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it.each(["MAX_TOKENS", "CONTINUATION", "OTHER", "MALFORMED_RESPONSE", undefined])("rejects unfinished output (%s), including its sources", async (finishReason) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ candidates: [{
      ...candidate(finishReason), groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/source" } }] },
    }] }));
    const result = await createChatResponse({ ...question, research: true }, env);
    expect(result).toMatchObject({ status: 502, body: { error: { code: "incomplete_response" } } });
    expect(result.body).not.toHaveProperty("message");
    expect(result.body).not.toHaveProperty("sources");
    expect(console.info).not.toHaveBeenCalled();
  });

  it("never silently clips a complete answer to the saved-message limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ candidates: [candidate("STOP", "x".repeat(6001))] }));
    await expect(createChatResponse(question, env)).resolves.toMatchObject({
      status: 502, body: { error: { code: "incomplete_response" } },
    });
  });

  it("accepts the full saved-message limit without clipping", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ candidates: [candidate("STOP", "x".repeat(6000))] }));
    await expect(createChatResponse(question, env)).resolves.toEqual({ status: 200, body: { message: "x".repeat(6000) } });
  });

  it("returns only final answer parts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, text: "Intermediate model notes." }, { text: completeAnswer },
    ] } }] }));
    await expect(createChatResponse(question, env)).resolves.toEqual({ status: 200, body: { message: completeAnswer } });
  });

  it("does not mistake thought-only output for an answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, text: "Intermediate model notes." },
    ] } }] }));
    await expect(createChatResponse(question, env)).resolves.toMatchObject({ status: 502, body: { error: { code: "invalid_response" } } });
  });

  it.each(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"])("does not return or retry provider-blocked text (%s)", async (finishReason) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ candidates: [candidate(finishReason)] }));
    await expect(createChatResponse(question, { ...env, GEMINI_CHAT_FALLBACK_MODELS: "gemini-2.5-flash-lite" }))
      .resolves.toMatchObject({ status: 422, body: { error: { code: "response_blocked" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(console.info).not.toHaveBeenCalled();
  });

  it("honors a prompt block without trying a different model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ promptFeedback: { blockReason: "SAFETY" } }));
    await expect(createChatResponse(question, { ...env, GEMINI_CHAT_FALLBACK_MODELS: "gemini-2.5-flash-lite" }))
      .resolves.toMatchObject({ status: 422, body: { error: { code: "response_blocked" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["fetch", "body"])("identifies a provider timeout during %s", async (phase) => {
    const timeout = new DOMException("Sensitive diagnostic detail", "TimeoutError");
    const response = jsonResponse({});
    vi.spyOn(response, "json").mockRejectedValue(timeout);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    if (phase === "fetch") fetchSpy.mockRejectedValue(timeout);
    else fetchSpy.mockResolvedValue(response);
    await expect(createChatResponse(question, env)).resolves.toMatchObject({ status: 504, body: { error: { code: "timeout" } } });
    expect(console.warn).toHaveBeenCalledWith("[DeepSpec Chat]", expect.objectContaining({ code: "timeout", success: false }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("Sensitive");
  });

  it("distinguishes a disconnected response body from malformed JSON", async () => {
    const response = jsonResponse({});
    vi.spyOn(response, "json").mockRejectedValue(new TypeError("Body stream disconnected"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(createChatResponse(question, env)).resolves.toMatchObject({ status: 502, body: { error: { code: "network" } } });
  });

  it.each([false, true])("bounds all configured attempts within the client timeout (research=%s)", async (research) => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const firstBudget = research ? 25_000 : 20_000;
    const remainingBudget = research ? 25_000 : 5_000;
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => { now += firstBudget; return jsonResponse({}, 503); })
      .mockImplementationOnce(async () => { now += remainingBudget; throw new DOMException("Timed out", "TimeoutError"); });
    await expect(createChatResponse({ ...question, research }, { ...env, GEMINI_CHAT_FALLBACK_MODELS: "fallback-one,fallback-two" }))
      .resolves.toMatchObject({ status: 504, body: { error: { code: "timeout" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(timeouts.mock.calls).toEqual([[firstBudget], [remainingBudget]]);
  });

  it("reports malformed provider JSON as an invalid response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{", { headers: { "Content-Type": "application/json" } }));
    await expect(createChatResponse(question, env)).resolves.toMatchObject({ status: 502, body: { error: { code: "invalid_response" } } });
  });

  it.each([400, 401, 403, 404, 503])("sanitizes and logs provider HTTP %s without exposing account details", async (status) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: { message: "private project id / test-only-key" } }, status));
    const result = await createChatResponse(question, env);
    expect(result).toMatchObject({ status: 502, body: { error: { code: "provider_error" } } });
    expect(console.warn).toHaveBeenCalledWith("[DeepSpec Chat]", expect.objectContaining({ providerStatus: status, code: "provider_error", success: false }));
    expect(JSON.stringify([result, vi.mocked(console.warn).mock.calls])).not.toMatch(/private project|test-only-key/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries an incomplete answer only on an already configured fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ candidates: [candidate("MAX_TOKENS", "Partial advice")] }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [candidate("STOP")] }));
    await expect(createChatResponse(question, { ...env, GEMINI_CHAT_FALLBACK_MODELS: "gemini-2.5-flash-lite" }))
      .resolves.toEqual({ status: 200, body: { message: completeAnswer } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
